package com.pomo.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pomo.achievements.Achievement
import com.pomo.crew.CrewValidation
import com.pomo.ui.components.Avatar
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.components.PomoDialog
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoTokens

@Composable
public fun ProfileScreen(
    displayName: String,
    avatarBase64: String?,
    keyFingerprint: String,
    lifetimeFocusMinutes: Int,
    currentStreak: Int,
    blocks: Int,
    achievementHighlights: List<Achievement>,
    achievementsEarned: Int,
    achievementsTotal: Int,
    onDisplayNameChange: (String) -> Unit,
    onAvatarPick: () -> Unit,
    onAvatarRemove: () -> Unit,
    onOpenAchievements: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSync: () -> Unit,
) {
    val scroll = rememberScrollState()
    var editing by remember { mutableStateOf(false) }
    var showAvatarSheet by remember { mutableStateOf(false) }
    var showRemoveConfirm by remember { mutableStateOf(false) }
    var showAvatarPreview by remember { mutableStateOf(false) }

    Column(
        modifier =
            Modifier
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

        Spacer(Modifier.height(24.dp))
        IdentityHeader(
            displayName = displayName,
            avatarBase64 = avatarBase64,
            keyFingerprint = keyFingerprint,
            onEditName = { editing = true },
            onAvatarTap = {
                if (avatarBase64 != null) {
                    showAvatarPreview = true
                } else {
                    onAvatarPick()
                }
            },
            onAvatarEdit = { showAvatarSheet = true },
        )

        Spacer(Modifier.height(28.dp))
        StatCards(
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

        Spacer(Modifier.height(8.dp))

        MenuRow(
            icon = Icons.Default.Sync,
            label = "Sync",
            subtitle = "Signals, Data History, and Recovery",
            onClick = onOpenSync,
        )

        MenuRow(
            icon = Icons.Default.Settings,
            label = "Settings",
            subtitle = "Manage your preferences",
            onClick = onOpenSettings,
        )
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

    if (showAvatarSheet) {
        AvatarActionSheet(
            hasAvatar = avatarBase64 != null,
            onDismiss = { showAvatarSheet = false },
            onView = {
                showAvatarSheet = false
                showAvatarPreview = true
            },
            onChange = {
                showAvatarSheet = false
                onAvatarPick()
            },
            onRemove = {
                showAvatarSheet = false
                showRemoveConfirm = true
            },
        )
    }

    if (showRemoveConfirm) {
        PomoDialog(
            onDismissRequest = { showRemoveConfirm = false },
            title = { Text("Remove photo?") },
            body = {
                Text(
                    text = "Your crew members will see your initial instead.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PomoTokens.colors.onSurfaceMuted,
                )
            },
            actions = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PomoButton(onClick = { showRemoveConfirm = false }, variant = PomoButtonVariant.Ghost) {
                        Text("Cancel")
                    }
                    PomoButton(onClick = {
                        showRemoveConfirm = false
                        onAvatarRemove()
                    }) {
                        Text("Remove")
                    }
                }
            },
        )
    }

    if (showAvatarPreview && avatarBase64 != null) {
        AvatarPreviewSheet(
            avatarBase64 = avatarBase64,
            displayName = displayName,
            onDismiss = { showAvatarPreview = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun IdentityHeader(
    displayName: String,
    avatarBase64: String?,
    keyFingerprint: String,
    onEditName: () -> Unit,
    onAvatarTap: () -> Unit,
    onAvatarEdit: () -> Unit,
) {
    val named = displayName.isNotBlank()

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                modifier =
                    Modifier
                        .size(88.dp)
                        .clip(CircleShape)
                        .border(2.dp, PomoTokens.colors.outline, CircleShape),
            ) {
                Avatar(
                    avatarBase64 = avatarBase64,
                    displayName = displayName,
                    size = 88.dp,
                    modifier = Modifier.clickable(onClick = onAvatarTap),
                )
            }
            IconButton(
                onClick = onAvatarEdit,
                modifier =
                    Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(PomoTokens.colors.surfaceElevated),
            ) {
                Icon(
                    imageVector = Icons.Default.CameraAlt,
                    contentDescription = "Edit photo",
                    modifier = Modifier.size(16.dp),
                    tint = PomoTokens.colors.onSurfaceMuted,
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            text = if (named) displayName else "Set your name",
            style = MaterialTheme.typography.headlineMedium,
            color = if (named) MaterialTheme.colorScheme.onSurface else PomoTokens.colors.onSurfaceFaint,
            modifier = Modifier.clickable(onClick = onEditName),
        )
        if (keyFingerprint.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Edit,
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = PomoTokens.colors.onSurfaceFaint,
                )
                Spacer(Modifier.width(4.dp))
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AvatarActionSheet(
    hasAvatar: Boolean,
    onDismiss: () -> Unit,
    onView: () -> Unit,
    onChange: () -> Unit,
    onRemove: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (hasAvatar) {
                AvatarActionRow(icon = Icons.Default.Photo, label = "View photo", onClick = onView)
            }
            AvatarActionRow(icon = Icons.Default.CameraAlt, label = "Change photo", onClick = onChange)
            if (hasAvatar) {
                AvatarActionRow(icon = Icons.Default.Delete, label = "Remove photo", onClick = onRemove, danger = true)
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun AvatarActionRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    danger: Boolean = false,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = if (danger) PomoTokens.colors.accent else MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.width(14.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (danger) PomoTokens.colors.accent else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AvatarPreviewSheet(
    avatarBase64: String,
    displayName: String,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = displayName,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
            Spacer(Modifier.height(16.dp))
            Avatar(
                avatarBase64 = avatarBase64,
                displayName = displayName,
                size = 240.dp,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun StatCards(
    lifetimeFocusMinutes: Int,
    currentStreak: Int,
    blocks: Int,
) {
    val focus = formatMinutes(lifetimeFocusMinutes)

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        IconStatCard(
            icon = Icons.Default.AccessTime,
            value = focus,
            label = "Focus",
            tint = PomoTokens.colors.focus,
            modifier = Modifier.weight(1f),
        )
        IconStatCard(
            icon = Icons.Outlined.LocalFireDepartment,
            value = currentStreak.toString(),
            label = "Day streak",
            tint = PomoTokens.colors.warn,
            modifier = Modifier.weight(1f),
        )
        IconStatCard(
            icon = Icons.Outlined.TaskAlt,
            value = blocks.toString(),
            label = "Blocks",
            tint = PomoTokens.colors.success,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun IconStatCard(
    icon: ImageVector,
    value: String,
    label: String,
    tint: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(14.dp))
                .background(PomoTokens.colors.surface)
                .padding(horizontal = 12.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = tint,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = PomoTokens.colors.onSurfaceFaint,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun MenuRow(
    icon: ImageVector,
    label: String,
    subtitle: String? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = PomoTokens.colors.onSurfaceMuted,
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = PomoTokens.colors.onSurfaceFaint,
                )
            }
        }
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = PomoTokens.colors.onSurfaceFaint,
        )
    }
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
                    text =
                        "This is the name your crews see. You have one name, and it is the " +
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
                    keyboardActions =
                        KeyboardActions(
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
