// app/src/main/java/com/pomo/db/AppDatabase.kt
package com.pomo.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [DayStatsEntity::class, SessionEntity::class],
    version = 3,
    exportSchema = true,
)
public abstract class AppDatabase : RoomDatabase() {

    public abstract fun historyDao(): HistoryDao

    public companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        public fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "pomo.db",
            )
                .addMigrations(MIGRATION_1_3, MIGRATION_2_3)
                .build()
        }

        public val MIGRATION_1_3: Migration = object : Migration(1, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                migrateSessionsToStartPrimaryKey(db)
            }
        }

        public val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                migrateSessionsToStartPrimaryKey(db)
            }
        }

        private fun migrateSessionsToStartPrimaryKey(db: SupportSQLiteDatabase) {
            val sessionColumns = tableColumns(db, "sessions")
            if ("id" in sessionColumns) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `sessions_new` (
                        `start` INTEGER NOT NULL,
                        `date` TEXT NOT NULL,
                        `type` TEXT NOT NULL,
                        `duration` INTEGER NOT NULL,
                        `completed` INTEGER NOT NULL,
                        `synced` INTEGER NOT NULL,
                        PRIMARY KEY(`start`),
                        FOREIGN KEY(`date`) REFERENCES `day_stats`(`date`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    INSERT OR IGNORE INTO `sessions_new` (`start`, `date`, `type`, `duration`, `completed`, `synced`)
                    SELECT `start`, `date`, `type`, `duration`, `completed`, 1
                    FROM `sessions`
                    ORDER BY `id` ASC
                    """.trimIndent(),
                )
                db.execSQL("DROP TABLE `sessions`")
                db.execSQL("ALTER TABLE `sessions_new` RENAME TO `sessions`")
            } else if ("synced" !in sessionColumns) {
                db.execSQL("ALTER TABLE `sessions` ADD COLUMN `synced` INTEGER NOT NULL DEFAULT 1")
            }
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_sessions_date` ON `sessions` (`date`)")
        }

        private fun tableColumns(db: SupportSQLiteDatabase, table: String): Set<String> {
            val cursor = db.query("PRAGMA table_info(`$table`)")
            return cursor.use {
                val nameIndex = it.getColumnIndexOrThrow("name")
                buildSet {
                    while (it.moveToNext()) {
                        add(it.getString(nameIndex))
                    }
                }
            }
        }
    }
}
