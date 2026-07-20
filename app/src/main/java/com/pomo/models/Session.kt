package com.pomo.models

public data class Session(
    val type: String,
    val start: Long,
    val duration: Int,
    val completed: Boolean,
    val tag: String? = null,
)
