package com.pomo.ui.screens

import android.content.Intent
import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.pomo.crew.CrewBoard
import com.pomo.crew.CrewHiddenMember
import com.pomo.crew.CrewJoinPreview
import com.pomo.crew.CrewValidation
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.components.PomoSheet
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.theme.PomoTokens
import java.util.Locale

@Composable
internal fun ManageCrewScreen(
    board: CrewBoard,
    onBack: () -> Unit,
    onCreateCrew: (String, String) -> Unit,
    onReviewJoin: (String) -> Unit,
    onJoinCrew: (String, String) -> Unit,
    onSwitchCrew: (String) -> Unit,
    onLeaveCrew: (String) -> Unit,
    onDisplayNameChange: (String) -> Unit,
    onMemberHiddenChange: (String, Boolean) -> Unit,
    onExportRecovery: () -> Unit,
    onImportRecovery: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var displayName by remember(board.displayName) { mutableStateOf(board.displayName) }
    var joinCode by remember { mutableStateOf("") }
    var createRequest by remember(board.displayName) { mutableStateOf<CreateCrewRequest?>(null) }
    val payload = remember(board.joinCode) { com.pomo.crew.CrewJoinCodeCodec.decode(board.joinCode) }
    val shareUri = payload?.let(com.pomo.crew.CrewJoinCodeCodec::encodeUri) ?: board.joinCode
    BackHandler(onBack = onBack)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = "Manage ${board.crewName}",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                CrewQrCode(shareUri)
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PomoButton(
                        onClick = {
                            context.startActivity(
                                Intent.createChooser(
                                    Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, "Join ${board.crewName} in Pomo:\n$shareUri")
                                    },
                                    "Share Crew",
                                ),
                            )
                        },
                    ) {
                        Icon(Icons.Outlined.Share, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Share Crew")
                    }
                    PomoButton(
                        onClick = { clipboard.setText(AnnotatedString(board.joinCode)) },
                        variant = PomoButtonVariant.Tonal,
                    ) {
                        Icon(Icons.Outlined.ContentCopy, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Copy code")
                    }
                }
            }
            item { SectionHeader("Identity") }
            item { NameField(displayName, onValueChange = { displayName = it }) }
            item {
                PomoButton(onClick = { onDisplayNameChange(displayName) }, variant = PomoButtonVariant.Tonal) {
                    Text("Save name")
                }
            }
            if (board.memberships.count { !it.isArchived } > 1) {
                item { SectionHeader("Switch Crew") }
                items(board.memberships.filterNot { it.isArchived }, key = { "switch-${it.crewId}" }) { membership ->
                    PomoButton(
                        onClick = { onSwitchCrew(membership.crewId) },
                        variant = if (membership.isActive) PomoButtonVariant.Tonal else PomoButtonVariant.Ghost,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(membership.crewName) }
                }
            }
            if (board.hiddenMembers.isNotEmpty()) {
                item { SectionHeader("Hidden members") }
                items(board.hiddenMembers, key = { "hidden-${it.identityPublicKey}" }) { member ->
                    HiddenMemberRow(member = member, onUnhide = {
                        onMemberHiddenChange(member.identityPublicKey, false)
                    })
                }
            }
            if (board.memberships.any { it.isArchived }) {
                item { SectionHeader("Archived v1") }
                items(board.memberships.filter { it.isArchived }, key = { "archived-${it.crewId}" }) { membership ->
                    Text(
                        text = "${membership.crewName} · ${membership.displayName}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                }
            }
            item { SectionHeader("Recovery") }
            item {
                Text(
                    text = "Export your current identity before restoring another one.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PomoTokens.colors.onSurfaceMuted,
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PomoButton(onClick = onExportRecovery, variant = PomoButtonVariant.Tonal) {
                        Text("Export Recovery")
                    }
                    PomoButton(onClick = onImportRecovery, variant = PomoButtonVariant.Ghost) {
                        Text("Restore Recovery")
                    }
                }
            }
            item { SectionHeader("Join another") }
            item {
                OutlinedTextField(
                    value = joinCode,
                    onValueChange = { joinCode = it },
                    label = { Text("Crew link or code") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                PomoButton(
                    onClick = { onReviewJoin(joinCode) },
                    enabled = joinCode.isNotBlank(),
                    variant = PomoButtonVariant.Tonal,
                ) { Text("Review Join") }
            }
            item { SectionHeader("Create another") }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PomoButton(
                        onClick = { createRequest = CreateCrewRequest(displayName) },
                        variant = PomoButtonVariant.Tonal,
                    ) { Text("Create") }
                    PomoButton(
                        onClick = { onLeaveCrew(board.crewId) },
                        variant = PomoButtonVariant.Ghost,
                    ) { Text("Leave Crew") }
                }
            }
        }
    }
    createRequest?.let { request ->
        CreateCrewSheet(
            initialDisplayName = request.initialDisplayName,
            onDismiss = { createRequest = null },
            onConfirm = { crewName, name ->
                onCreateCrew(crewName, name)
                createRequest = null
            },
        )
    }
}

@Composable
private fun HiddenMemberRow(member: CrewHiddenMember, onUnhide: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = member.displayName,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = formatMinutes(member.selectedFocusMinutes),
                style = MaterialTheme.typography.bodySmall,
                color = PomoTokens.colors.onSurfaceMuted,
                fontFamily = FontFamily.Monospace,
            )
        }
        PomoButton(onClick = onUnhide, variant = PomoButtonVariant.Ghost) {
            Text("Unhide")
        }
    }
}

@Composable
private fun CrewQrCode(value: String) {
    val bitmap = remember(value) {
        val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, QR_SIZE, QR_SIZE)
        Bitmap.createBitmap(QR_SIZE, QR_SIZE, Bitmap.Config.ARGB_8888).apply {
            val pixels = IntArray(QR_SIZE * QR_SIZE) { index ->
                val x = index % QR_SIZE
                val y = index / QR_SIZE
                if (matrix[x, y]) QR_FOREGROUND else QR_BACKGROUND
            }
            setPixels(pixels, 0, QR_SIZE, 0, 0, QR_SIZE, QR_SIZE)
        }
    }
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "QR code to join Crew",
            modifier = Modifier.size(160.dp),
        )
        Text("SCAN TO JOIN", style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceMuted)
    }
}

@Composable
internal fun JoinConfirmationSheet(
    pending: PendingJoin,
    loadPreview: suspend (String) -> CrewJoinPreview?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var preview by remember(pending.joinCode) { mutableStateOf<CrewJoinPreview?>(null) }
    var displayName by remember(pending.joinCode) { mutableStateOf(pending.initialDisplayName) }
    LaunchedEffect(pending.joinCode) {
        preview = loadPreview(pending.joinCode)
    }
    val normalizedDisplayName = remember(displayName) {
        CrewValidation.normalizeDisplayName(displayName)
    }
    val duplicateName = normalizedDisplayName
        ?.trim()
        ?.lowercase(Locale.ROOT)
        ?.let { normalized -> preview?.knownDisplayNames?.contains(normalized) == true }
        ?: false

    PomoSheet(title = "Join Crew", onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = pending.payload.crewName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Shared focus, measured together.",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            preview?.let { stats ->
                JoinPreviewStats(stats)
            }
            NameField(value = displayName, onValueChange = { displayName = it })
            if (duplicateName) {
                Text(
                    text = "Name already in use in this Crew. Your key will still distinguish you.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PomoTokens.colors.onSurfaceMuted,
                )
            }
            PomoButton(
                onClick = { normalizedDisplayName?.let(onConfirm) },
                enabled = normalizedDisplayName != null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Join Crew") }
        }
    }
}

@Composable
internal fun CreateCrewSheet(
    initialDisplayName: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var crewName by remember(initialDisplayName) { mutableStateOf("") }
    var displayName by remember(initialDisplayName) { mutableStateOf(initialDisplayName) }
    val normalizedCrewName = remember(crewName) { CrewValidation.normalizeCrewName(crewName) }
    val normalizedDisplayName = remember(displayName) { CrewValidation.normalizeDisplayName(displayName) }

    PomoSheet(title = "Create Crew", onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                "Shared focus, measured together.",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            OutlinedTextField(
                value = crewName,
                onValueChange = { crewName = it },
                label = { Text("Crew name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            NameField(value = displayName, onValueChange = { displayName = it })
            PomoButton(
                onClick = {
                    val name = normalizedCrewName
                    val display = normalizedDisplayName
                    if (name != null && display != null) onConfirm(name, display)
                },
                enabled = normalizedCrewName != null && normalizedDisplayName != null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Create Crew") }
        }
    }
}

@Composable
private fun JoinPreviewStats(preview: CrewJoinPreview) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PreviewStat(value = preview.activeMembers.toString(), label = "ACTIVE", modifier = Modifier.weight(1f))
        PreviewStat(value = formatMinutes(preview.todayFocusMinutes), label = "TODAY", modifier = Modifier.weight(1f))
        PreviewStat(value = formatMinutes(preview.medianMemberFocusMinutes), label = "MEDIAN", modifier = Modifier.weight(1f))
    }
}

@Composable
private fun PreviewStat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = PomoTokens.colors.onSurfaceMuted,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
internal fun NameField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text("Display name") },
        supportingText = { Text("Required") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}
