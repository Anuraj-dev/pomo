package com.pomo.sync.transport

import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.DataOutputStream
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
        val read = input.read(prefix)
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
        val length = httpContentLength(input)
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
                return ReplicaLanCodec.decodeResponse(connection.inputStream.readBytes())
            } finally {
                connection.disconnect()
            }
        }

        private fun readFrame(input: java.io.InputStream): ByteArray {
            val framed = DataInputStream(input)
            val length = framed.readInt()
            require(length in 1..ReplicaLanCodec.MAX_FRAME_BYTES) { "replica LAN frame is out of bounds" }
            val bytes = ByteArray(length)
            framed.readFully(bytes)
            return bytes
        }

        private fun httpContentLength(input: BufferedInputStream): Int {
            val header = StringBuilder()
            while (!header.endsWith("\r\n\r\n")) {
                val next = input.read()
                require(next >= 0) { "truncated replica HTTP header" }
                header.append(next.toChar())
                require(header.length <= 8_192) { "replica HTTP header is too large" }
            }
            val match = Regex("Content-Length:\\s*(\\d+)", RegexOption.IGNORE_CASE).find(header)
            require(match != null) { "replica HTTP Content-Length is required" }
            return match.groupValues[1].toInt()
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
