package com.pomo.sync.transport

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URL
import java.nio.charset.StandardCharsets

internal data class ReplicaLanPeer(
    val deviceId: String,
    val host: String,
    val port: Int,
    val httpUrl: String? = null,
)

internal class ReplicaLanListener(
    private val session: ReplicaLanSession,
) {
    private var server: ServerSocket? = null
    private var thread: Thread? = null

    val port: Int
        get() = server?.localPort ?: error("replica LAN listener is stopped")

    fun start(): Int {
        check(server == null) { "replica LAN listener already started" }
        val bound = ServerSocket(0, 50, InetAddress.getByName("0.0.0.0"))
        server = bound
        thread =
            Thread(
                {
                    while (!bound.isClosed) {
                        try {
                            bound.accept().use { socket -> serve(socket) }
                        } catch (_: SocketException) {
                            if (bound.isClosed) break
                        } catch (_: Exception) {
                            continue
                        }
                    }
                },
                "pomo-replica-lan",
            ).apply {
                isDaemon = true
                start()
            }
        return bound.localPort
    }

    fun stop() {
        runCatching { server?.close() }
        server = null
        thread?.join(1_000)
        thread = null
    }

    private fun serve(socket: Socket) {
        socket.soTimeout = TIMEOUT_MS
        val input = BufferedInputStream(socket.getInputStream())
        input.mark(4)
        val prefix = ByteArray(4)
        val read = readFullyOrEof(input, prefix)
        input.reset()
        if (read == 4 && prefix.decodeToString() == "POST") {
            serveHttp(socket, input)
            return
        }
        val request = ReplicaLanCodec.decodeRequest(readFrame(input))
        writeFrame(socket, ReplicaLanCodec.encodeResponse(session.handle(request)))
    }

    private fun serveHttp(
        socket: Socket,
        input: BufferedInputStream,
    ) {
        val header = readHttpHeader(input)
        if (header.method != "POST" || header.path != HTTP_PATH) {
            writeHttpStatus(socket, 404, "Not Found")
            return
        }
        if (!header.contentType.lowercase().startsWith("application/cbor")) {
            writeHttpStatus(socket, 415, "Unsupported Media Type")
            return
        }
        val length = header.contentLength
        require(length in 1..ReplicaLanCodec.MAX_FRAME_BYTES) { "replica HTTP body is out of bounds" }
        val body = ByteArray(length)
        DataInputStream(input).readFully(body)
        val response = ReplicaLanCodec.encodeResponse(session.handle(ReplicaLanCodec.decodeRequest(body)))
        val head =
            "HTTP/1.1 200 OK\r\nContent-Type: application/cbor\r\nContent-Length: ${response.size}\r\nConnection: close\r\n\r\n"
        val output = socket.getOutputStream()
        output.write(head.toByteArray(StandardCharsets.US_ASCII))
        output.write(response)
        output.flush()
    }

    companion object {
        const val TIMEOUT_MS: Int = 5_000

        const val HTTP_PATH: String = "/replica"

        fun exchange(
            peer: ReplicaLanPeer,
            request: ReplicaLanRequest,
        ): ReplicaLanResponse {
            Socket().use { socket ->
                socket.soTimeout = TIMEOUT_MS
                socket.connect(InetSocketAddress(peer.host, peer.port), TIMEOUT_MS)
                writeFrame(socket, ReplicaLanCodec.encodeRequest(request))
                return ReplicaLanCodec.decodeResponse(readFrame(socket.getInputStream()))
            }
        }

        fun exchangeHttp(
            url: String,
            request: ReplicaLanRequest,
        ): ReplicaLanResponse {
            val encoded = ReplicaLanCodec.encodeRequest(request)
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/cbor")
                connection.setRequestProperty("Content-Length", encoded.size.toString())
                connection.outputStream.use { it.write(encoded) }
                require(connection.responseCode == 200) { "replica HTTP status ${connection.responseCode}" }
                val declared = connection.contentLength
                require(declared < 0 || declared in 1..ReplicaLanCodec.MAX_FRAME_BYTES) {
                    "replica HTTP response is out of bounds"
                }
                return ReplicaLanCodec.decodeResponse(readBounded(connection.inputStream, ReplicaLanCodec.MAX_FRAME_BYTES))
            } finally {
                connection.disconnect()
            }
        }

        private fun readFrame(input: InputStream): ByteArray {
            val framed = DataInputStream(input)
            val length = framed.readInt()
            require(length in 1..ReplicaLanCodec.MAX_FRAME_BYTES) { "replica LAN frame is out of bounds" }
            val bytes = ByteArray(length)
            framed.readFully(bytes)
            return bytes
        }

        private fun readFullyOrEof(
            input: InputStream,
            buffer: ByteArray,
        ): Int {
            var offset = 0
            while (offset < buffer.size) {
                val next = input.read(buffer, offset, buffer.size - offset)
                if (next < 0) return offset
                offset += next
            }
            return offset
        }

        private fun readBounded(
            input: InputStream,
            maxBytes: Int,
        ): ByteArray {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8_192)
            var total = 0
            while (true) {
                val next = input.read(buffer)
                if (next < 0) break
                total += next
                require(total <= maxBytes) { "replica HTTP response is out of bounds" }
                out.write(buffer, 0, next)
            }
            val bytes = out.toByteArray()
            require(bytes.isNotEmpty()) { "replica HTTP response is empty" }
            return bytes
        }

        private data class HttpHeader(
            val method: String,
            val path: String,
            val contentLength: Int,
            val contentType: String,
        )

        private fun readHttpHeader(input: BufferedInputStream): HttpHeader {
            val header = StringBuilder()
            while (!header.endsWith("\r\n\r\n")) {
                val next = input.read()
                require(next >= 0) { "truncated replica HTTP header" }
                header.append(next.toChar())
                require(header.length <= 8_192) { "replica HTTP header is too large" }
            }
            val text = header.toString()
            val requestLine = text.lineSequence().firstOrNull()?.trim().orEmpty()
            val parts = requestLine.split(' ')
            require(parts.size >= 2) { "replica HTTP request line is malformed" }
            val target = parts[1]
            val path = target.substringBefore('?').substringBefore('#')
            val lengthMatch = Regex("Content-Length:\\s*(\\d+)", RegexOption.IGNORE_CASE).find(text)
            require(lengthMatch != null) { "replica HTTP Content-Length is required" }
            val typeMatch = Regex("Content-Type:\\s*([^\\r\\n]+)", RegexOption.IGNORE_CASE).find(text)
            return HttpHeader(
                method = parts[0].uppercase(),
                path = path,
                contentLength = lengthMatch.groupValues[1].toInt(),
                contentType = typeMatch?.groupValues?.get(1)?.trim().orEmpty(),
            )
        }

        private fun writeHttpStatus(
            socket: Socket,
            code: Int,
            reason: String,
        ) {
            val head = "HTTP/1.1 $code $reason\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            val output = socket.getOutputStream()
            output.write(head.toByteArray(StandardCharsets.US_ASCII))
            output.flush()
        }

        private fun writeFrame(
            socket: Socket,
            bytes: ByteArray,
        ) {
            require(bytes.size in 1..ReplicaLanCodec.MAX_FRAME_BYTES)
            val output = DataOutputStream(socket.getOutputStream())
            output.writeInt(bytes.size)
            output.write(bytes)
            output.flush()
        }
    }
}
