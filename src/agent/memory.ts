import Database from 'better-sqlite3';
import { config } from '../config/env.js';
import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface MessageRecord {
  id?: number | string;
  userId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string | null;
  toolCallId?: string | null;
  toolCalls?: string | null; // serialized JSON
  imageUrl?: string | null; // Serialized base64 screenshot
  timestamp: string | any;
}

export interface IMemory {
  addMessage(userId: string | number, role: string, content: string, options?: any): Promise<void> | void;
  getMessages(userId: string | number, limit?: number): Promise<MessageRecord[]> | MessageRecord[];
  clearMemory(userId: string | number): Promise<void> | void;
}

class SQLiteMemory implements IMemory {
  private db: Database.Database;

  constructor() {
    this.db = new Database(config.DB_PATH);
    this.initDb();
    try {
      this.db.exec('ALTER TABLE messages ADD COLUMN imageUrl TEXT');
    } catch (e) {
      // Column already exists or other non-critical error
    }
  }

  private initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        name TEXT,
        toolCallId TEXT,
        toolCalls TEXT,
        imageUrl TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_userId ON messages (userId);
    `);
  }

  addMessage(userId: string | number, role: string, content: string, options?: any) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (userId, role, content, name, toolCallId, toolCalls, imageUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      userId.toString(),
      role,
      content,
      options?.name || null,
      options?.toolCallId || null,
      options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
      options?.imageUrl || null
    );
  }

  getMessages(userId: string | number, limit = 50): MessageRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages 
      WHERE userId = ? 
      ORDER BY timestamp DESC, id DESC 
      LIMIT ?
    `);
    const results = stmt.all(userId.toString(), limit) as MessageRecord[];
    return results.reverse();
  }

  clearMemory(userId: string | number) {
    const stmt = this.db.prepare('DELETE FROM messages WHERE userId = ?');
    stmt.run(userId.toString());
  }
}

class FirestoreMemory implements IMemory {
  private db: admin.firestore.Firestore;

  constructor() {
    const serviceAccountPath = resolve(process.cwd(), config.GOOGLE_APPLICATION_CREDENTIALS);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(readFileSync(serviceAccountPath, 'utf8'))),
      });
    }
    this.db = admin.firestore();
    console.log('[Memory] Initialized Cloud Firestore Storage');
  }

  async addMessage(userId: string | number, role: string, content: string, options?: any) {
    const docRef = this.db.collection('conversations').doc(userId.toString()).collection('messages').doc();
    await docRef.set({
      userId: userId.toString(),
      role,
      content,
      name: options?.name || null,
      toolCallId: options?.toolCallId || null,
      toolCalls: options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
      imageUrl: options?.imageUrl || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  async getMessages(userId: string | number, limit = 50): Promise<MessageRecord[]> {
    const snapshot = await this.db
      .collection('conversations')
      .doc(userId.toString())
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate().toISOString() || new Date().toISOString(),
      } as MessageRecord;
    });

    return messages.reverse();
  }

  async clearMemory(userId: string | number) {
    const batch = this.db.batch();
    const snapshot = await this.db.collection('conversations').doc(userId.toString()).collection('messages').get();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

// Factory export
function createMemory(): IMemory {
  const saPath = resolve(process.cwd(), config.GOOGLE_APPLICATION_CREDENTIALS);
  if (existsSync(saPath)) {
    try {
      return new FirestoreMemory();
    } catch (e) {
      console.error('[Memory] Failed to init Firestore, falling back to SQLite:', e);
    }
  }
  console.log('[Memory] Using Local SQLite Storage');
  return new SQLiteMemory();
}

export const memory = createMemory();
