import { type Database, getDatabase } from 'firebase-admin/database';
import { getApp } from './app.ts';

let _realtimeDatabase: Database | undefined;

export const getRealTimeDatabase = () => {
  if (_realtimeDatabase) {
    return _realtimeDatabase;
  }
  _realtimeDatabase = getDatabase(getApp());

  return _realtimeDatabase;
};
