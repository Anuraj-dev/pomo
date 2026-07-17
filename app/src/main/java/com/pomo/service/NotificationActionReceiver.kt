package com.pomo.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

public class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent?,
    ) {
        if (intent == null || intent.action == null) return

        val serviceIntent = Intent(context, PomodoroService::class.java)
        serviceIntent.action = intent.action

        PomodoroServiceStarter.start(context, serviceIntent)
    }
}
