package com.pomo.sync.transport

import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException

internal data class ReplicaLanPeer(
    val deviceId: String,
    val host: String,
    val port: Int,
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
        val request = ReplicaLanCodec.decodeRequest(readFrame(socket))
        writeFrame(socket, ReplicaLanCodec.encodeResponse(session.handle(request)))
    }

    companion object {
        const val TIMEOUT_MS: Int = 5_000

        fun exchange(
            peer: ReplicaLanPeer,
            request: ReplicaLanRequest,
        ): ReplicaLanResponse {
            Socket(peer.host, peer.port).use { socket ->
                socket.soTimeout = TIMEOUT_MS
                writeFrame(socket, ReplicaLanCodec.encodeRequest(request))
                return ReplicaLanCodec.decodeResponse(readFrame(socket))
            }
        }

        private fun readFrame(socket: Socket): ByteArray {
            val input = DataInputStream(socket.getInputStream())
            val length = input.readInt()
            require(length in 1..ReplicaLanCodec.MAX_FRAME_BYTES) { "replica LAN frame is out of bounds" }
            val bytes = ByteArray(length)
            input.readFully(bytes)
            return bytes
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
