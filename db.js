const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'nch-mlm.db');

class MLMDatabase {
    constructor() {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Failed to open MLM SQLite DB:', err.message);
            } else {
                console.log(`✅ MLM SQLite DB connected: ${dbPath}`);
            }
        });
        this.initTables();
    }

    initTables() {
        this.db.serialize(() => {
            // Binary Tree Nodes table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS binary_tree (
                    walletAddress TEXT PRIMARY KEY,
                    sponsorAddress TEXT,
                    uplineAddress TEXT,
                    position TEXT,
                    leftVolume REAL DEFAULT 0,
                    rightVolume REAL DEFAULT 0,
                    leftCarryover REAL DEFAULT 0,
                    rightCarryover REAL DEFAULT 0,
                    totalEarned REAL DEFAULT 0,
                    rank TEXT DEFAULT 'Member',
                    joinedAt INTEGER
                )
            `);

            // Commission Payout History Table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS mlm_commissions (
                    id TEXT PRIMARY KEY,
                    walletAddress TEXT,
                    type TEXT,
                    amount REAL,
                    weakLegVolume REAL,
                    timestamp INTEGER,
                    status TEXT DEFAULT 'PAID'
                )
            `);

            // Daily Earnings Cap Tracker
            this.db.run(`
                CREATE TABLE IF NOT EXISTS daily_earnings (
                    walletAddress TEXT,
                    dateStr TEXT,
                    amount REAL DEFAULT 0,
                    PRIMARY KEY (walletAddress, dateStr)
                )
            `);

            // Users Profiles & System status (Web3 Wallet Address Primary Key)
            this.db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    walletAddress TEXT PRIMARY KEY,
                    username TEXT UNIQUE,
                    referrerUsername TEXT,
                    legPreference TEXT DEFAULT 'L',
                    isActive INTEGER DEFAULT 0,
                    packageUsdt REAL DEFAULT 0,
                    withdrawableUsdt REAL DEFAULT 0,
                    rank TEXT DEFAULT 'Member',
                    joinedAt INTEGER,
                    packageActivatedAt INTEGER DEFAULT 0,
                    isAdmin INTEGER DEFAULT 0
                )
            `);

            // Migration safeties for existing databases
            this.db.run("ALTER TABLE users ADD COLUMN packageActivatedAt INTEGER DEFAULT 0", () => {});
            this.db.run("ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0", () => {});

            // Withdrawals Log
            this.db.run(`
                CREATE TABLE IF NOT EXISTS withdrawals (
                    id TEXT PRIMARY KEY,
                    walletAddress TEXT,
                    amountUsdt REAL,
                    status TEXT DEFAULT 'PENDING',
                    timestamp INTEGER
                )
            `);

            // System Settings
            this.db.run(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            `, () => {
                // Seed initial settings
                this.db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('nch_usdt_price', '0.02')");
                this.db.run("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('platform_master_address', '0x3801490C9f806c917b8CbA710Db9135FA3B116ae')");
            });

            console.log('✅ MLM SQLite Tables initialized successfully');
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
}

module.exports = new MLMDatabase();
