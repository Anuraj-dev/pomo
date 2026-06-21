package com.pomo.ui.screens

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.pomo.crew.CrewBoard
import com.pomo.crew.CrewHiddenMember
import com.pomo.crew.CrewBoardRow
import com.pomo.crew.CrewJoinCodeCodec
import com.pomo.crew.CrewJoinPayload
import com.pomo.crew.CrewMembershipSummary
import com.pomo.crew.CrewRankingMode
import com.pomo.ui.components.EmptyState
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.components.PomoSheet
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.components.SegmentedToggle
import com.pomo.ui.components.SegmentedToggleOption
import com.pomo.ui.components.StatTile
import com.pomo.ui.theme.PomoTokens
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import java.util.Locale
import kotlin.math.roundToInt

public data class CrewScreenState(
    val isLoading: Boolean = false,
    val board: CrewBoard? = null,
    val archivedMemberships: List<CrewMembershipSummary> = emptyList(),
    val errorMessage: String? = null,
)

@Composable
public fun CrewScreen(
    state: CrewScreenState,
    onCreateCrew: (String, String) -> Unit,
    onJoinCrew: (String, String) -> Unit,
    onSwitchCrew: (String) -> Unit,
    onLeaveCrew: (String) -> Unit,
    onDisplayNameChange: (String) -> Unit,
    onRankingModeChange: (CrewRankingMode) -> Unit,
    onMemberHiddenChange: (String, Boolean) -> Unit,
    onExportRecovery: () -> Unit,
    onImportRecovery: () -> Unit,
    initialJoinCode: String? = null,
    onInitialJoinCodeConsumed: () -> Unit = {},
) {
    var pendingJoin by remember { mutableStateOf<PendingJoin?>(null) }
    val requestJoin: (String, String) -> Unit = { joinCode, displayName ->
        val payload = CrewJoinCodeCodec.decode(joinCode.trim())
        if (payload == null) {
            onJoinCrew(joinCode, displayName)
        } else {
            pendingJoin = PendingJoin(joinCode.trim(), displayName, payload)
        }
    }
    LaunchedEffect(initialJoinCode) {
        if (initialJoinCode != null) {
            CrewJoinCodeCodec.decode(initialJoinCode)?.let { payload ->
                pendingJoin = PendingJoin(initialJoinCode, "", payload)
            }
            onInitialJoinCodeConsumed()
        }
    }
    when {
        state.isLoading && state.board == null -> CrewLoadingState()
        state.board == null -> CrewEmptyState(
            archivedMemberships = state.archivedMemberships,
            errorMessage = state.errorMessage,
            onCreateCrew = onCreateCrew,
            onJoinCrew = requestJoin,
        )
        else -> CrewBoardContent(
            board = state.board,
            onCreateCrew = onCreateCrew,
            onJoinCrew = requestJoin,
            onSwitchCrew = onSwitchCrew,
            onLeaveCrew = onLeaveCrew,
            onDisplayNameChange = onDisplayNameChange,
            onRankingModeChange = onRankingModeChange,
            onMemberHiddenChange = onMemberHiddenChange,
            onExportRecovery = onExportRecovery,
            onImportRecovery = onImportRecovery,
        )
    }
    pendingJoin?.let { pending ->
        JoinConfirmationSheet(
            pending = pending,
            onDismiss = { pendingJoin = null },
            onConfirm = {
                onJoinCrew(pending.joinCode, pending.displayName)
                pendingJoin = null
            },
        )
    }
}

@Composable
private fun CrewLoadingState() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            headline = "Loading Crew",
            body = "Reading the last-known leaderboard.",
            icon = Icons.Outlined.Groups,
        )
    }
}

@Composable
private fun CrewEmptyState(
    archivedMemberships: List<CrewMembershipSummary>,
    errorMessage: String?,
    onCreateCrew: (String, String) -> Unit,
    onJoinCrew: (String, String) -> Unit,
) {
    var crewName by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var joinCode by remember { mutableStateOf("") }
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            EmptyState(
                headline = if (archivedMemberships.isEmpty()) "No Crew yet" else "Crew v2 required",
                body = if (archivedMemberships.isEmpty()) {
                    "Create a private leaderboard or join one shared by a friend."
                } else {
                    "Older Crew memberships were archived locally. Create or join a v2 Crew for active rankings."
                },
                icon = Icons.Outlined.Groups,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (archivedMemberships.isNotEmpty()) {
            item {
                SectionHeader("Archived v1")
                Spacer(Modifier.height(8.dp))
                archivedMemberships.forEach { membership ->
                    Text(
                        text = "${membership.crewName} · ${membership.displayName}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                }
            }
        }
        item {
            SectionHeader("Create")
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = crewName,
                onValueChange = { crewName = it },
                label = { Text("Crew name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            NameField(displayName, onValueChange = { displayName = it })
        }
        item {
            PomoButton(
                onClick = { onCreateCrew(crewName, displayName) },
                enabled = crewName.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Create Crew") }
        }
        item {
            SectionHeader("Join")
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = joinCode,
                onValueChange = { joinCode = it },
                label = { Text("Crew link or join code") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            PomoButton(
                onClick = { onJoinCrew(joinCode, displayName) },
                enabled = joinCode.isNotBlank(),
                variant = PomoButtonVariant.Tonal,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Review Join") }
        }
        if (errorMessage != null) {
            item {
                Text(errorMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun CrewBoardContent(
    board: CrewBoard,
    onCreateCrew: (String, String) -> Unit,
    onJoinCrew: (String, String) -> Unit,
    onSwitchCrew: (String) -> Unit,
    onLeaveCrew: (String) -> Unit,
    onDisplayNameChange: (String) -> Unit,
    onRankingModeChange: (CrewRankingMode) -> Unit,
    onMemberHiddenChange: (String, Boolean) -> Unit,
    onExportRecovery: () -> Unit,
    onImportRecovery: () -> Unit,
) {
    var showManage by remember { mutableStateOf(false) }
    var selectedMember by remember { mutableStateOf<CrewBoardRow?>(null) }
    var search by remember { mutableStateOf("") }
    var showInactive by remember { mutableStateOf(false) }
    val activeRows = board.rows.filterNot { it.isInactive }
    val inactiveRows = board.rows.filter { it.isInactive }
    val duplicateNames = activeRows.groupingBy { it.displayName.trim().lowercase(Locale.ROOT) }
        .eachCount()
        .filterValues { it > 1 }
        .keys
    val visibleRows = activeRows.filter { row -> row.matchesSearch(search, duplicateNames) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 32.dp),
    ) {
        item(key = "header") {
            CrewHeader(board, onManage = { showManage = true })
            Spacer(Modifier.height(20.dp))
        }
        item(key = "window") {
            RankingWindowControl(board.rankingMode, onRankingModeChange)
            Spacer(Modifier.height(20.dp))
        }
        item(key = "summary") {
            CrewSummary(activeRows)
            Spacer(Modifier.height(20.dp))
        }
        item(key = "standing") {
            YourStanding(activeRows)
            Spacer(Modifier.height(20.dp))
        }
        if (activeRows.size > SEARCH_THRESHOLD) {
            item(key = "search") {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    label = { Text("Search members") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                )
            }
        }
        item(key = "leaderboard-heading") {
            SectionHeader("Leaderboard")
            Spacer(Modifier.height(4.dp))
        }
        items(visibleRows, key = { it.identityPublicKey }) { row ->
            CrewRow(
                row = row,
                showFingerprint = row.displayName.trim().lowercase(Locale.ROOT) in duplicateNames,
                onClick = { selectedMember = row },
            )
            HorizontalDivider(color = PomoTokens.colors.outline)
        }
        if (visibleRows.isEmpty()) {
            item(key = "no-results") {
                Text(
                    text = if (search.isBlank()) "NO ACTIVE MEMBERS" else "NO MATCHES",
                    modifier = Modifier.padding(vertical = 24.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = PomoTokens.colors.onSurfaceMuted,
                )
            }
        }
        if (inactiveRows.isNotEmpty()) {
            item(key = "inactive-toggle") {
                PomoButton(
                    onClick = { showInactive = !showInactive },
                    variant = PomoButtonVariant.Ghost,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (showInactive) "Hide inactive" else "Inactive · ${inactiveRows.size}")
                }
            }
            if (showInactive) {
                items(inactiveRows, key = { "inactive-${it.identityPublicKey}" }) { row ->
                    CrewRow(row, showFingerprint = false, onClick = { selectedMember = row })
                    HorizontalDivider(color = PomoTokens.colors.outline)
                }
            }
        }
    }

    if (showManage) {
        ManageCrewSheet(
            board = board,
            onDismiss = { showManage = false },
            onCreateCrew = onCreateCrew,
            onJoinCrew = onJoinCrew,
            onSwitchCrew = onSwitchCrew,
            onLeaveCrew = onLeaveCrew,
            onDisplayNameChange = onDisplayNameChange,
            onMemberHiddenChange = onMemberHiddenChange,
            onExportRecovery = onExportRecovery,
            onImportRecovery = onImportRecovery,
        )
    }
    selectedMember?.let { row ->
        MemberDetailSheet(
            row = row,
            onDismiss = { selectedMember = null },
            onHide = {
                onMemberHiddenChange(row.identityPublicKey, true)
                selectedMember = null
            },
        )
    }
}

@Composable
private fun CrewHeader(board: CrewBoard, onManage: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = board.crewName,
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = freshnessLabel(board),
                style = MaterialTheme.typography.labelSmall,
                color = freshnessColor(board),
                fontFamily = FontFamily.Monospace,
            )
        }
        PomoButton(onClick = onManage, variant = PomoButtonVariant.Ghost) {
            Icon(Icons.Outlined.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Manage")
        }
    }
}

@Composable
private fun RankingWindowControl(mode: CrewRankingMode, onChange: (CrewRankingMode) -> Unit) {
    SegmentedToggle(
        options = listOf(
            SegmentedToggleOption(CrewRankingMode.Today.name, "Today"),
            SegmentedToggleOption(CrewRankingMode.SevenDays.name, "7D"),
            SegmentedToggleOption(CrewRankingMode.ThirtyDays.name, "30D"),
            SegmentedToggleOption(CrewRankingMode.AllTime.name, "All"),
        ),
        selectedValue = mode.name,
        onSelectedValueChange = { onChange(CrewRankingMode.valueOf(it)) },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun CrewSummary(rows: List<CrewBoardRow>) {
    val participating = rows.filter { it.selectedFocusMinutes > 0 }
    val total = participating.sumOf { it.selectedFocusMinutes }
    val median = participating.map { it.selectedFocusMinutes }.sorted().median()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatTile(formatMinutes(total), "CREW FOCUS", Modifier.weight(1f))
        StatTile(participating.size.toString(), "ACTIVE", Modifier.weight(1f))
        StatTile(formatMinutes(median), "MEDIAN", Modifier.weight(1f))
    }
}

@Composable
private fun YourStanding(rows: List<CrewBoardRow>) {
    val self = rows.firstOrNull { it.isSelf } ?: return
    val context = standingContext(self, rows)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PomoTokens.colors.surface)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text("YOUR STANDING", style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceMuted)
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(
                text = self.rank?.let { "#$it" } ?: "—",
                style = MaterialTheme.typography.headlineLarge,
                color = PomoTokens.colors.accent,
                fontFamily = FontFamily.Monospace,
            )
            Spacer(Modifier.width(12.dp))
            Text(formatMinutes(self.selectedFocusMinutes), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.weight(1f))
            Text(context, style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceMuted)
        }
    }
}

@Composable
private fun CrewRow(row: CrewBoardRow, showFingerprint: Boolean, onClick: () -> Unit) {
    val rankLabel = row.rank?.let { "#$it" } ?: "—"
    val displayLabel = if (showFingerprint) {
        "${row.displayName} · ${row.identityPublicKey.take(4).uppercase(Locale.ROOT)}"
    } else {
        row.displayName
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .alpha(if (row.isStale) 0.58f else 1f)
            .semantics {
                contentDescription = "$rankLabel, $displayLabel, ${formatMinutes(row.selectedFocusMinutes)}"
            }
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            rankLabel,
            modifier = Modifier.width(42.dp),
            style = MaterialTheme.typography.titleMedium,
            color = if (row.rank == 1) PomoTokens.colors.accent else PomoTokens.colors.onSurfaceMuted,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (row.isSelf) "$displayLabel · YOU" else displayLabel,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = rowMeta(row),
                style = MaterialTheme.typography.bodySmall,
                color = PomoTokens.colors.onSurfaceMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        SevenDayBars(row)
        Spacer(Modifier.width(12.dp))
        Text(
            formatMinutes(row.selectedFocusMinutes),
            style = MaterialTheme.typography.titleMedium,
            color = if (row.isSelf) PomoTokens.colors.accent else MaterialTheme.colorScheme.onSurface,
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun SevenDayBars(row: CrewBoardRow) {
    val values = row.dailyAggregates.take(7).reversed().map { it.focusMinutes }
    val max = values.maxOrNull()?.coerceAtLeast(1) ?: 1
    Row(
        modifier = Modifier
            .width(34.dp)
            .height(24.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        repeat(7) { index ->
            val value = values.getOrElse(index) { 0 }
            val height = if (value == 0) 2.dp else (4 + 20 * value / max).dp
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(height)
                    .background(if (value == max && value > 0) PomoTokens.colors.accent else PomoTokens.colors.onSurfaceMuted),
            )
        }
    }
}

@Composable
private fun MemberDetailSheet(row: CrewBoardRow, onDismiss: () -> Unit, onHide: () -> Unit) {
    val activeDays = row.dailyAggregates.count { it.focusMinutes > 0 }
    val average = row.dailyAggregates.filter { it.focusMinutes > 0 }
        .map { it.focusMinutes }
        .average()
        .takeUnless { it.isNaN() }
        ?.roundToInt()
        ?: 0
    val best = row.dailyAggregates.maxByOrNull { it.focusMinutes }
    PomoSheet(title = row.displayName, onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(formatMinutes(row.thirtyDayFocusMinutes), "30 DAY", Modifier.weight(1f))
                StatTile(activeDays.toString(), "ACTIVE DAYS", Modifier.weight(1f))
                StatTile(formatMinutes(average), "ACTIVE AVG", Modifier.weight(1f))
            }
            DetailFact("Best day", best?.let { "${it.localDate} · ${formatMinutes(it.focusMinutes)}" } ?: "—")
            DetailFact("Work blocks", row.dailyAggregates.sumOf { it.completedWorkBlocks }.toString())
            DetailFact("Current streak", "${row.currentStreak}d")
            DetailFact("Identity", row.identityPublicKey.take(12).uppercase(Locale.ROOT))
            if (!row.isSelf) {
                PomoButton(onClick = onHide, variant = PomoButtonVariant.Ghost) { Text("Hide member locally") }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun DetailFact(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f), color = PomoTokens.colors.onSurfaceMuted)
        Text(value, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun ManageCrewSheet(
    board: CrewBoard,
    onDismiss: () -> Unit,
    onCreateCrew: (String, String) -> Unit,
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
    var crewName by remember { mutableStateOf("") }
    var joinCode by remember { mutableStateOf("") }
    val payload = remember(board.joinCode) { CrewJoinCodeCodec.decode(board.joinCode) }
    val shareUri = payload?.let(CrewJoinCodeCodec::encodeUri) ?: board.joinCode
    PomoSheet(title = "Manage ${board.crewName}", onDismissRequest = onDismiss) {
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
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
                    onClick = { onJoinCrew(joinCode, displayName) },
                    enabled = joinCode.isNotBlank(),
                    variant = PomoButtonVariant.Tonal,
                ) { Text("Review Join") }
            }
            item { SectionHeader("Create another") }
            item {
                OutlinedTextField(
                    value = crewName,
                    onValueChange = { crewName = it },
                    label = { Text("Crew name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PomoButton(
                        onClick = { onCreateCrew(crewName, displayName) },
                        enabled = crewName.isNotBlank(),
                        variant = PomoButtonVariant.Tonal,
                    ) { Text("Create") }
                    PomoButton(
                        onClick = { onLeaveCrew(board.crewId) },
                        variant = PomoButtonVariant.Ghost,
                    ) { Text("Leave Crew") }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
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
            modifier = Modifier.size(220.dp),
        )
        Text("SCAN TO JOIN", style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceMuted)
    }
}

@Composable
private fun JoinConfirmationSheet(
    pending: PendingJoin,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    PomoSheet(title = "Join ${pending.payload.crewName}", onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                "Anyone holding this link can read aggregate Crew stats and publish self-reported scores.",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            SectionHeader("Relays")
            pending.payload.relays.forEach { relay ->
                Text(relay.removePrefix("wss://"), fontFamily = FontFamily.Monospace)
            }
            PomoButton(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) { Text("Join Crew") }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun NameField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text("Display name") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun CrewBoardRow.matchesSearch(query: String, duplicateNames: Set<String>): Boolean {
    val normalized = query.trim().lowercase(Locale.ROOT)
    if (normalized.isEmpty()) return true
    return displayName.lowercase(Locale.ROOT).contains(normalized) ||
        (displayName.trim().lowercase(Locale.ROOT) in duplicateNames && identityPublicKey.startsWith(normalized))
}

private fun standingContext(self: CrewBoardRow, rows: List<CrewBoardRow>): String {
    val rank = self.rank ?: return "UNRANKED"
    val tied = rows.count { it.rank == rank }
    if (tied > 1) return "TIED WITH ${tied - 1}"
    if (rank == 1) {
        val second = rows.firstOrNull { it.rank != null && it.rank > 1 } ?: return "SOLE LEADER"
        return "+${formatMinutes(self.selectedFocusMinutes - second.selectedFocusMinutes)} LEAD"
    }
    val next = rows.lastOrNull { it.rank != null && it.rank < rank } ?: return "RANKED"
    return "${formatMinutes(next.selectedFocusMinutes - self.selectedFocusMinutes)} TO #${next.rank}"
}

private fun rowMeta(row: CrewBoardRow): String = buildList {
    add("${row.currentStreak}d streak")
    add("${row.todaySessionCount} blocks today")
    if (row.isStale) add("stale")
    if (row.isInactive) add("inactive")
}.joinToString(" · ")

private fun freshnessLabel(board: CrewBoard): String {
    val updated = board.lastUpdatedEpochSeconds ?: return "NO SNAPSHOTS"
    val ageSeconds = ((System.currentTimeMillis() / 1000L) - updated).coerceAtLeast(0L)
    val age = when {
        ageSeconds < 60 -> "NOW"
        ageSeconds < 3600 -> "${ageSeconds / 60}m AGO"
        else -> "${ageSeconds / 3600}h AGO"
    }
    return when {
        board.successfulRelayCount == 0 -> "OFFLINE · UPDATED $age"
        board.successfulRelayCount < board.totalRelayCount ->
            "PARTIAL · ${board.successfulRelayCount}/${board.totalRelayCount} RELAYS · $age"
        else -> "UPDATED $age"
    }
}

@Composable
private fun freshnessColor(board: CrewBoard) =
    if (board.successfulRelayCount == 0) PomoTokens.colors.warn else PomoTokens.colors.onSurfaceMuted

private fun formatMinutes(minutes: Int): String = when {
    minutes < 60 -> "${minutes}m"
    minutes % 60 == 0 -> "${minutes / 60}h"
    else -> "${minutes / 60}h ${minutes % 60}m"
}

private fun List<Int>.median(): Int {
    if (isEmpty()) return 0
    val middle = size / 2
    return if (size % 2 == 1) this[middle] else (this[middle - 1] + this[middle]) / 2
}

private const val SEARCH_THRESHOLD: Int = 20
private const val QR_SIZE: Int = 512
private const val QR_FOREGROUND: Int = -0xefecea
private const val QR_BACKGROUND: Int = -0x90807

private data class PendingJoin(
    val joinCode: String,
    val displayName: String,
    val payload: CrewJoinPayload,
)
