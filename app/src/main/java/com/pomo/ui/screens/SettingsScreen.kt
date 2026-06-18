package com.pomo.ui.screens

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.pomo.R
import com.pomo.cues.CompletionCueFamily
import com.pomo.cues.CuePreviewChannel
import com.pomo.cues.CueVariant
import com.pomo.cues.StateCueEvent
import com.pomo.service.PomodoroService
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.theme.PomoRadius
import com.pomo.util.UtilPreferenceManager

public sealed interface SettingsItem {
    public data class Section(val title: String) : SettingsItem
    public data class Note(val text: String) : SettingsItem
    public data class IntPref(
        val key: String,
        val title: String,
        val summary: String,
        val default: Int,
    ) : SettingsItem
    public data class BoolPref(
        val key: String,
        val title: String,
        val summary: String,
        val default: Boolean,
    ) : SettingsItem
    public data class ChoicePref(
        val key: String,
        val title: String,
        val summary: String,
        val default: String,
        val choices: List<Choice>,
    ) : SettingsItem
    public data class Action(
        val title: String,
        val summary: String,
        val onClick: () -> Unit,
        val iconRes: Int? = null,
    ) : SettingsItem
    public data class CompletionCuePreview(
        val family: CompletionCueFamily,
        val title: String,
        val summary: String,
        val serviceProvider: () -> PomodoroService?,
        val onFeedback: (Int) -> Unit,
    ) : SettingsItem
    public data class ManualHapticPreview(
        val event: StateCueEvent,
        val title: String,
        val summary: String,
        val serviceProvider: () -> PomodoroService?,
        val onFeedback: (Int) -> Unit,
    ) : SettingsItem

    public data class Choice(
        val value: String,
        val label: String,
    )
}

private data class SettingsGroup(
    val title: String?,
    val items: List<SettingsItem>,
)

private fun groupSettings(items: List<SettingsItem>): List<SettingsGroup> {
    val out = mutableListOf<SettingsGroup>()
    var currentTitle: String? = null
    var current = mutableListOf<SettingsItem>()
    items.forEach { item ->
        if (item is SettingsItem.Section) {
            if (current.isNotEmpty() || currentTitle != null) {
                out += SettingsGroup(currentTitle, current.toList())
            }
            currentTitle = item.title
            current = mutableListOf()
        } else {
            current += item
        }
    }
    if (current.isNotEmpty() || currentTitle != null) {
        out += SettingsGroup(currentTitle, current.toList())
    }
    return out
}

@Composable
public fun SettingsScreen(
    sharedPreferences: SharedPreferences,
    items: List<SettingsItem>,
) {
    val groups = remember(items) { groupSettings(items) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Box(Modifier.padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 8.dp)) {
            Text(
                "Settings",
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            items(groups, key = { it.title ?: "_" }) { group ->
                SettingsGroupCard(group, sharedPreferences)
            }
            item { Spacer(Modifier.height(32.dp)) }
        }
    }
}

@Composable
private fun SettingsGroupCard(group: SettingsGroup, prefs: SharedPreferences) {
    Column {
        if (group.title != null) {
            SectionHeader(group.title, modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
        }
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(PomoRadius.Lg),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column {
                group.items.forEachIndexed { i, item ->
                    if (i > 0) {
                        HorizontalDivider(
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                            thickness = 1.dp,
                            modifier = Modifier.padding(start = 16.dp),
                        )
                    }
                    when (item) {
                        is SettingsItem.Section -> Unit
                        is SettingsItem.Note -> NoteRow(item)
                        is SettingsItem.IntPref -> IntPrefRow(prefs, item)
                        is SettingsItem.BoolPref -> BoolPrefRow(prefs, item)
                        is SettingsItem.ChoicePref -> ChoicePrefRow(prefs, item)
                        is SettingsItem.Action -> ActionRow(item)
                        is SettingsItem.CompletionCuePreview -> CompletionCuePreviewRow(prefs, item)
                        is SettingsItem.ManualHapticPreview -> ManualHapticPreviewRow(prefs, item)
                    }
                }
            }
        }
    }
}

@Composable
private fun NoteRow(item: SettingsItem.Note) {
    Text(
        text = item.text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
    )
}

@Composable
private fun IntPrefRow(prefs: SharedPreferences, item: SettingsItem.IntPref) {
    var current by remember(item.key) {
        mutableStateOf(prefs.getString(item.key, item.default.toString()) ?: item.default.toString())
    }
    DisposableEffect(item.key) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { sp, k ->
            if (k == item.key) {
                current = sp.getString(item.key, item.default.toString()) ?: item.default.toString()
            }
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    var editing by remember { mutableStateOf(false) }

    PrefRow(
        title = item.title,
        summary = item.summary,
        valueText = current,
        onClick = { editing = true },
        leadingIconRes = null,
    )

    if (editing) {
        var draft by remember { mutableStateOf(current) }
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text(item.title) },
            text = {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.filter(Char::isDigit) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val parsed = draft.toIntOrNull() ?: item.default
                    val sanitized = UtilPreferenceManager.sanitizeIntPreference(item.key, parsed, item.default)
                    prefs.edit().putString(item.key, sanitized.toString()).apply()
                    editing = false
                }) { Text("OK") }
            },
            dismissButton = {
                TextButton(onClick = { editing = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ChoicePrefRow(prefs: SharedPreferences, item: SettingsItem.ChoicePref) {
    var current by remember(item.key) {
        mutableStateOf(prefs.getString(item.key, item.default) ?: item.default)
    }
    DisposableEffect(item.key) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { sp, k ->
            if (k == item.key) current = sp.getString(item.key, item.default) ?: item.default
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    var editing by remember { mutableStateOf(false) }
    val currentLabel = item.choices.firstOrNull { it.value == current }?.label
        ?: item.choices.firstOrNull { it.value == item.default }?.label
        ?: current

    PrefRow(
        title = item.title,
        summary = item.summary,
        valueText = currentLabel,
        onClick = { editing = true },
        leadingIconRes = null,
    )

    if (editing) {
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text(item.title) },
            text = {
                Column {
                    item.choices.forEach { choice ->
                        Text(
                            text = choice.label,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    current = choice.value
                                    prefs.edit().putString(item.key, choice.value).apply()
                                    editing = false
                                }
                                .padding(vertical = 12.dp),
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (choice.value == current) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { editing = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun BoolPrefRow(prefs: SharedPreferences, item: SettingsItem.BoolPref) {
    var checked by remember(item.key) {
        mutableStateOf(prefs.getBoolean(item.key, item.default))
    }
    DisposableEffect(item.key) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { sp, k ->
            if (k == item.key) checked = sp.getBoolean(item.key, item.default)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                val next = !checked
                checked = next
                prefs.edit().putBoolean(item.key, next).apply()
            }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                item.summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = {
                checked = it
                prefs.edit().putBoolean(item.key, it).apply()
            },
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
            ),
        )
    }
}

@Composable
private fun ActionRow(item: SettingsItem.Action) {
    PrefRow(
        title = item.title,
        summary = item.summary,
        valueText = null,
        onClick = item.onClick,
        leadingIconRes = item.iconRes,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CompletionCuePreviewRow(
    prefs: SharedPreferences,
    item: SettingsItem.CompletionCuePreview,
) {
    val context = LocalContext.current
    val soundEnabled = rememberPrefBoolean(prefs, "sound_enabled", true)
    val vibrationEnabled = rememberPrefBoolean(prefs, "vibrate_enabled", true)
    val strongerEnabled = rememberPrefBoolean(prefs, "stronger_completion_cues", false)
    val nextVariantNumber = rememberPrefInt(prefs, item.family.nextVariantPrefKey, CueVariant.Variant1.number)
    var selectedVariant by remember(item.family) { mutableStateOf(CueVariant.fromNumber(nextVariantNumber)) }
    val serviceProvider by rememberUpdatedState(item.serviceProvider)
    val vibrationAvailable = remember(context) { context.hasVibratorCapability() }

    DisposableEffect(nextVariantNumber) {
        selectedVariant = CueVariant.fromNumber(nextVariantNumber)
        onDispose { }
    }

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(
            item.title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            item.summary,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "Next up: Variant $nextVariantNumber",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(8.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = selectedVariant == CueVariant.Variant1,
                onClick = { selectedVariant = CueVariant.Variant1 },
                label = { Text("Variant 1") },
            )
            FilterChip(
                selected = selectedVariant == CueVariant.Variant2,
                onClick = { selectedVariant = CueVariant.Variant2 },
                label = { Text("Variant 2") },
            )
            FilterChip(
                selected = selectedVariant == CueVariant.Variant3,
                onClick = { selectedVariant = CueVariant.Variant3 },
                label = { Text("Variant 3") },
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            text = buildString {
                append(if (soundEnabled) "Sound on" else "Sound off")
                append(" · ")
                append(
                    when {
                        !vibrationEnabled -> "Vibration off"
                        !vibrationAvailable -> "Vibration unavailable"
                        else -> "Vibration on"
                    },
                )
                if (strongerEnabled) {
                    append(" · Stronger completion cues on")
                }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilledTonalButton(
                onClick = {
                    val service = serviceProvider()
                    if (service == null) {
                        item.onFeedback(R.string.state_cues_preview_service_unavailable)
                        return@FilledTonalButton
                    }
                    service.previewCompletionCue(item.family, selectedVariant, CuePreviewChannel.Combined)
                        .messageRes
                        ?.let(item.onFeedback)
                },
            ) { Text("Preview") }
            FilledTonalButton(
                onClick = {
                    val service = serviceProvider()
                    if (service == null) {
                        item.onFeedback(R.string.state_cues_preview_service_unavailable)
                        return@FilledTonalButton
                    }
                    service.previewCompletionCue(item.family, selectedVariant, CuePreviewChannel.AudioOnly)
                        .messageRes
                        ?.let(item.onFeedback)
                },
            ) { Text("Audio only") }
            FilledTonalButton(
                onClick = {
                    val service = serviceProvider()
                    if (service == null) {
                        item.onFeedback(R.string.state_cues_preview_service_unavailable)
                        return@FilledTonalButton
                    }
                    service.previewCompletionCue(item.family, selectedVariant, CuePreviewChannel.HapticOnly)
                        .messageRes
                        ?.let(item.onFeedback)
                },
            ) { Text("Haptic only") }
        }
    }
}

@Composable
private fun ManualHapticPreviewRow(
    prefs: SharedPreferences,
    item: SettingsItem.ManualHapticPreview,
) {
    val context = LocalContext.current
    val serviceProvider by rememberUpdatedState(item.serviceProvider)
    val vibrationEnabled = rememberPrefBoolean(prefs, "vibrate_enabled", true)
    val vibrationAvailable = remember(context) { context.hasVibratorCapability() }

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
        Text(
            item.title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            item.summary,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = when {
                !vibrationEnabled -> "Vibration off"
                !vibrationAvailable -> "Vibration unavailable"
                else -> "Vibration on"
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))
        FilledTonalButton(
            onClick = {
                val service = serviceProvider()
                if (service == null) {
                    item.onFeedback(R.string.state_cues_preview_service_unavailable)
                    return@FilledTonalButton
                }
                service.previewManualCue(item.event).messageRes?.let(item.onFeedback)
            },
        ) { Text("Preview haptic") }
    }
}

@Composable
private fun PrefRow(
    title: String,
    summary: String,
    valueText: String?,
    onClick: () -> Unit,
    leadingIconRes: Int?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIconRes != null) {
            Icon(
                painter = painterResource(leadingIconRes),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(end = 12.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (valueText != null) {
            Text(
                valueText,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.padding(end = 2.dp))
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun rememberPrefBoolean(
    prefs: SharedPreferences,
    key: String,
    default: Boolean,
): Boolean {
    var value by remember(key) { mutableStateOf(prefs.getBoolean(key, default)) }
    DisposableEffect(key) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { sp, changedKey ->
            if (changedKey == key) value = sp.getBoolean(key, default)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return value
}

@Composable
private fun rememberPrefInt(
    prefs: SharedPreferences,
    key: String,
    default: Int,
): Int {
    var value by remember(key) { mutableStateOf(prefs.getInt(key, default)) }
    DisposableEffect(key) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { sp, changedKey ->
            if (changedKey == key) value = sp.getInt(key, default)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return value
}

private fun Context.hasVibratorCapability(): Boolean {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val manager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        manager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    return vibrator.hasVibrator()
}
