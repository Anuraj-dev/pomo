package com.pomo.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pomo.timer.TimerState
import com.pomo.ui.components.PhaseChip
import com.pomo.ui.components.StatTile
import com.pomo.ui.theme.Gold
import com.pomo.ui.theme.PomoMotion
import com.pomo.ui.theme.StatusConnected
import com.pomo.ui.theme.TimerTextStyle
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale

public data class TimerStats(
    val todayMinutes: Int = 0,
    val todaySessions: Int = 0,
    val streak: Int = 0,
)

@Composable
public fun TimerScreen(
    state: TimerState?,
    stats: TimerStats,
    dailyGoal: Int,
    fallbackWorkSeconds: Int,
    onToggle: () -> Unit,
    onSkip: () -> Unit,
    onReset: () -> Unit,
    onStatsClick: () -> Unit,
) {
    val rawPhaseColor = when (state?.phase) {
        TimerState.PHASE_WORK -> MaterialTheme.colorScheme.primary
        TimerState.PHASE_SHORT, TimerState.PHASE_LONG -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.primary
    }
    val phaseColor by animateColorAsState(
        targetValue = rawPhaseColor,
        animationSpec = tween(PomoMotion.DurationL, easing = PomoMotion.EaseStandard),
        label = "phase-color",
    )
    val phaseLabel = when (state?.phase) {
        TimerState.PHASE_WORK -> "Focus"
        TimerState.PHASE_SHORT -> "Short break"
        TimerState.PHASE_LONG -> "Long break"
        else -> "Focus"
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TimerHeader()
        Spacer(Modifier.height(14.dp))
        PhaseQueue(
            completedSessions = state?.completed ?: 0,
            dailyGoal = dailyGoal,
            phaseColor = phaseColor,
        )
        Spacer(Modifier.height(18.dp))

        Box(
            modifier = Modifier.size(360.dp),
            contentAlignment = Alignment.Center,
        ) {
            TimerRings(
                state = state,
                phaseColor = phaseColor,
                completedSessions = state?.completed ?: 0,
                dailyGoal = dailyGoal,
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                TimerText(state, phaseColor, fallbackWorkSeconds)
                Spacer(Modifier.height(10.dp))
                AnimatedContent(targetState = phaseLabel, label = "phase-label") { label ->
                    PhaseChip(label = label, color = phaseColor)
                }
            }
        }

        Spacer(Modifier.height(22.dp))
        StatsStrip(stats, sessionsOverride = state?.completed, onClick = onStatsClick)
        Spacer(Modifier.weight(1f))
        ControlsRow(
            isRunning = state?.status == TimerState.STATUS_RUNNING,
            isPaused = state?.status == TimerState.STATUS_PAUSED,
            phaseColor = phaseColor,
            onToggle = onToggle,
            onSkip = onSkip,
            onReset = onReset,
        )
    }
}

@Composable
private fun TimerHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Pomo",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.displayLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(StatusConnected),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "Phone primary",
                color = StatusConnected,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun PhaseQueue(
    completedSessions: Int,
    dailyGoal: Int,
    phaseColor: Color,
) {
    val count = dailyGoal.coerceIn(1, 12)
    Row(
        modifier = Modifier.height(24.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val isDone = index < completedSessions
            val isCurrent = index == completedSessions.coerceAtMost(count - 1)
            val dotSize = if (isCurrent) 10.dp else 8.dp
            Box(
                modifier = Modifier
                    .size(dotSize)
                    .clip(CircleShape)
                    .background(
                        when {
                            isDone -> Gold
                            isCurrent -> phaseColor
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        },
                    ),
            )
        }
    }
}

@Composable
private fun TimerText(state: TimerState?, color: Color, fallbackWorkSeconds: Int) {
    val now = remember { mutableStateOf(System.currentTimeMillis()) }
    val syncTime = remember(state) { System.currentTimeMillis() }

    LaunchedEffect(state) {
        while (state?.status == TimerState.STATUS_RUNNING) {
            now.value = System.currentTimeMillis()
            delay(250)
        }
        now.value = System.currentTimeMillis()
    }

    val text = if (state == null) {
        formatClock(fallbackWorkSeconds.toDouble(), includeCentiseconds = false)
    } else {
        formatClock(computeRemaining(state, syncTime, now.value), includeCentiseconds = true)
    }

    Text(
        text = text,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        color = color,
        style = TimerTextStyle,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun TimerRings(
    state: TimerState?,
    phaseColor: Color,
    completedSessions: Int,
    dailyGoal: Int,
) {
    val track = MaterialTheme.colorScheme.surfaceVariant
    val now = remember { mutableStateOf(System.currentTimeMillis()) }
    val syncTime = remember(state) { System.currentTimeMillis() }
    LaunchedEffect(state) {
        while (state?.status == TimerState.STATUS_RUNNING) {
            now.value = System.currentTimeMillis()
            delay(250)
        }
        now.value = System.currentTimeMillis()
    }

    val timerProgress = computeProgress(state, syncTime, now.value)
    val animatedTimer by animateFloatAsState(
        targetValue = timerProgress,
        animationSpec = tween(PomoMotion.DurationM, easing = PomoMotion.EaseStandard),
        label = "timer-progress",
    )
    val goalProgress = if (dailyGoal > 0) {
        (completedSessions.toFloat() / dailyGoal).coerceIn(0f, 1f)
    } else {
        0f
    }
    val animatedGoal by animateFloatAsState(
        targetValue = goalProgress,
        animationSpec = tween(PomoMotion.DurationL, easing = PomoMotion.EaseOutExpo),
        label = "goal-progress",
    )

    Canvas(modifier = Modifier.fillMaxSize()) {
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(phaseColor.copy(alpha = 0.18f), Color.Transparent),
                center = center,
                radius = size.minDimension * 0.45f,
            ),
            radius = size.minDimension * 0.45f,
            center = center,
        )

        val outerStroke = 14.dp.toPx()
        val innerStroke = 14.dp.toPx()
        val outerInset = outerStroke / 2f + 8.dp.toPx()
        val innerInset = outerInset + 32.dp.toPx()

        drawSegmentedGoalRing(
            track = track,
            fill = Gold,
            progress = animatedGoal,
            segments = dailyGoal.coerceIn(1, 12),
            inset = outerInset,
            strokeWidth = outerStroke,
        )

        drawArc(
            color = track,
            startAngle = -90f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(innerInset, innerInset),
            size = Size(size.width - innerInset * 2, size.height - innerInset * 2),
            style = Stroke(width = innerStroke, cap = StrokeCap.Round),
        )
        if (animatedTimer > 0f) {
            drawArc(
                color = phaseColor,
                startAngle = -90f,
                sweepAngle = 360f * animatedTimer,
                useCenter = false,
                topLeft = Offset(innerInset, innerInset),
                size = Size(size.width - innerInset * 2, size.height - innerInset * 2),
                style = Stroke(width = innerStroke, cap = StrokeCap.Round),
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSegmentedGoalRing(
    track: Color,
    fill: Color,
    progress: Float,
    segments: Int,
    inset: Float,
    strokeWidth: Float,
) {
    val gapDegrees = 4f
    val sweep = (360f / segments) - gapDegrees
    val filledSegments = progress * segments
    repeat(segments) { index ->
        val start = -90f + index * (360f / segments) + gapDegrees / 2f
        drawArc(
            color = track,
            startAngle = start,
            sweepAngle = sweep,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - inset * 2, size.height - inset * 2),
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
        )
        val fillAmount = (filledSegments - index).coerceIn(0f, 1f)
        if (fillAmount > 0f) {
            drawArc(
                color = fill,
                startAngle = start,
                sweepAngle = sweep * fillAmount,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = Size(size.width - inset * 2, size.height - inset * 2),
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
private fun StatsStrip(
    stats: TimerStats,
    sessionsOverride: Int?,
    onClick: () -> Unit,
) {
    val hours = stats.todayMinutes / 60
    val mins = stats.todayMinutes % 60
    val focusText = if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
    val sessions = sessionsOverride ?: stats.todaySessions

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatTile(focusText, "Today", Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally)
        StatDivider()
        StatTile("$sessions", "Sessions", Modifier.weight(1f), accentColor = MaterialTheme.colorScheme.secondary, horizontalAlignment = Alignment.CenterHorizontally)
        StatDivider()
        StatTile("${stats.streak}", "Streak", Modifier.weight(1f), accentColor = Gold, horizontalAlignment = Alignment.CenterHorizontally)
    }
}

@Composable
private fun StatDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(42.dp)
            .background(MaterialTheme.colorScheme.outline),
    )
}

@Composable
private fun ControlsRow(
    isRunning: Boolean,
    isPaused: Boolean,
    phaseColor: Color,
    onToggle: () -> Unit,
    onSkip: () -> Unit,
    onReset: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    var resetPressed by remember { mutableStateOf(false) }
    val resetFill by animateFloatAsState(
        targetValue = if (resetPressed) 1f else 0f,
        animationSpec = tween(600),
        label = "reset-hold",
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onSkip()
            },
            modifier = Modifier.size(56.dp),
        ) {
            Icon(Icons.Default.SkipNext, contentDescription = "Skip", tint = phaseColor)
        }
        Spacer(Modifier.width(26.dp))
        FloatingActionButton(
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onToggle()
            },
            containerColor = phaseColor,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            shape = CircleShape,
            modifier = Modifier.size(80.dp),
        ) {
            Icon(
                imageVector = if (isRunning) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (isRunning) "Pause" else if (isPaused) "Resume" else "Start",
                modifier = Modifier.size(34.dp),
            )
        }
        Spacer(Modifier.width(26.dp))
        IconButton(
            onClick = {},
            modifier = Modifier
                .size(56.dp)
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown()
                        resetPressed = true
                        val releasedEarly = withTimeoutOrNull(600) {
                            waitForUpOrCancellation()
                        } != null
                        if (!releasedEarly) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            onReset()
                            waitForUpOrCancellation()
                        }
                        resetPressed = false
                    }
                },
        ) {
            Box(contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(34.dp)) {
                    if (resetFill > 0f) {
                        drawArc(
                            color = phaseColor.copy(alpha = 0.24f),
                            startAngle = -90f,
                            sweepAngle = 360f * resetFill,
                            useCenter = true,
                        )
                    }
                }
                Icon(Icons.Default.Refresh, contentDescription = "Hold to reset", tint = phaseColor)
            }
        }
    }
}

private fun formatClock(seconds: Double, includeCentiseconds: Boolean): String {
    val totalSeconds = seconds.toInt().coerceAtLeast(0)
    val mins = totalSeconds / 60
    val secs = totalSeconds % 60
    if (!includeCentiseconds) {
        return String.format(Locale.US, "%02d:%02d", mins, secs)
    }
    val cs = ((seconds - totalSeconds) * 100).toInt().coerceIn(0, 99)
    return String.format(Locale.US, "%02d:%02d.%02d", mins, secs, cs)
}

private fun computeRemaining(state: TimerState?, syncTime: Long, nowMs: Long): Double {
    if (state == null) return 0.0
    if (state.status != TimerState.STATUS_RUNNING) return state.remaining
    val elapsed = (nowMs - syncTime) / 1000.0
    return (state.remaining - elapsed).coerceAtLeast(0.0)
}

private fun computeProgress(state: TimerState?, syncTime: Long, nowMs: Long): Float {
    if (state == null) return 0f
    val total = if (state.duration > 0) state.duration else when (state.phase) {
        TimerState.PHASE_WORK -> 1500.0
        TimerState.PHASE_SHORT -> 300.0
        TimerState.PHASE_LONG -> 900.0
        else -> 1500.0
    }
    val remaining = computeRemaining(state, syncTime, nowMs)
    return (remaining / total).toFloat().coerceIn(0f, 1f)
}
