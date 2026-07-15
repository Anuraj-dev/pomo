package com.pomo.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.achievements.Achievement
import com.pomo.crew.CrewValidation
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.components.PomoDialog
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoTokens

/**
 * The member's Profile. Flat and typographic: hairlines divide, nothing is raised, and the Display
 * name is the largest thing on the page. See docs/adr/0004-profile-replaces-settings-in-the-nav.md.
 */
@Composable
public fun ProfileScreen(
    displayName: String,
    keyFingerprint: String,
    lifetimeFocusMinutes: Int,
    currentStreak: Int,
    blocks: Int,
    achievementHighlights: List<Achievement>,
    achievementsEarned: Int,
    achievementsTotal: Int,
    onDisplayNameChange: (String) -> Unit,
    onOpenAchievements: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val scroll = rememberScrollState()
    var editing by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scroll)
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text(
            text = "Profile",
            style = MaterialTheme.typography.titleLarge,
            color = PomoTokens.colors.onSurfaceMuted,
        )

        Spacer(Modifier.height(20.dp))
        IdentityHeader(
            displayName = displayName,
            keyFingerprint = keyFingerprint,
            onEdit = { editing = true },
        )

        Spacer(Modifier.height(28.dp))
        StatStrip(
            lifetimeFocusMinutes = lifetimeFocusMinutes,
            currentStreak = currentStreak,
            blocks = blocks,
        )

        AchievementHighlightsRow(
            highlights = achievementHighlights,
            earnedCount = achievementsEarned,
            total = achievementsTotal,
            onClick = onOpenAchievements,
        )
        Hairline()

        SettingsRow(onOpenSettings = onOpenSettings)
    }

    if (editing) {
        DisplayNameDialog(
            initial = displayName,
            onDismiss = { editing = false },
            onSave = { name ->
                editing = false
                onDisplayNameChange(name)
            },
        )
    }
}

@Composable
private fun IdentityHeader(
    displayName: String,
    keyFingerprint: String,
    onEdit: () -> Unit,
) {
    val named = displayName.isNotBlank()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onEdit)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LetterTile(displayName = displayName)
        Spacer(Modifier.width(14.dp))
        Column {
            Text(
                text = if (named) displayName else "Set your name",
                style = MaterialTheme.typography.headlineLarge,
                color = if (named) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    PomoTokens.colors.onSurfaceFaint
                },
            )
            if (keyFingerprint.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = keyFingerprint,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = JetBrainsMono,
                    color = PomoTokens.colors.onSurfaceFaint,
                )
            }
        }
    }
}

/** No avatars: the tile is generated from the name, so nothing has to be picked, stored, or sent. */
@Composable
private fun LetterTile(displayName: String) {
    val initial = displayName.trim().firstOrNull()?.uppercase() ?: "?"

    Box(
        modifier = Modifier
            .size(52.dp)
            .background(PomoTokens.colors.accent, RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initial,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color.White,
        )
    }
}

@Composable
private fun StatStrip(
    lifetimeFocusMinutes: Int,
    currentStreak: Int,
    blocks: Int,
) {
    val focus = formatMinutes(lifetimeFocusMinutes)

    Hairline()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatColumn(value = focus, label = "Focus", modifier = Modifier.weight(1f))
        StatDivider()
        StatColumn(
            value = currentStreak.toString(),
            label = "Day streak",
            modifier = Modifier.weight(1f),
        )
        StatDivider()
        StatColumn(value = blocks.toString(), label = "Blocks", modifier = Modifier.weight(1f))
    }
    Hairline()
}

@Composable
private fun StatColumn(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(3.dp))
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = PomoTokens.colors.onSurfaceFaint,
        )
    }
}

@Composable
private fun StatDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(34.dp)
            .background(PomoTokens.colors.outline),
    )
}

@Composable
private fun Hairline() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(PomoTokens.colors.outline),
    )
}

@Composable
private fun SettingsRow(onOpenSettings: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpenSettings)
            .padding(vertical = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Settings",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = "›",
            style = MaterialTheme.typography.bodyLarge,
            fontSize = 20.sp,
            color = PomoTokens.colors.onSurfaceFaint,
        )
    }
    Hairline()
}

@Composable
private fun DisplayNameDialog(
    initial: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var value by remember { mutableStateOf(initial) }
    val normalized = CrewValidation.normalizeDisplayName(value)

    PomoDialog(
        onDismissRequest = onDismiss,
        title = { Text("Your name") },
        body = {
            Column {
                Text(
                    text = "This is the name your crews see. You have one name, and it is the " +
                        "same in every crew.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PomoTokens.colors.onSurfaceMuted,
                )
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(
                        onDone = { normalized?.let(onSave) },
                    ),
                )
            }
        },
        actions = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PomoButton(onClick = onDismiss, variant = PomoButtonVariant.Ghost) {
                    Text("Cancel")
                }
                PomoButton(
                    onClick = { normalized?.let(onSave) },
                    variant = PomoButtonVariant.Tonal,
                    enabled = normalized != null,
                ) {
                    Text("Save")
                }
            }
        },
    )
}
