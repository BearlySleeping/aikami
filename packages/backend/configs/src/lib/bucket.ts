import { getStorage, type Storage } from 'firebase-admin/storage';

import { getApp } from './app.ts';

let _bucket: ReturnType<Storage['bucket']> | undefined;

export const getBucket = () => {
  if (!_bucket) {
    _bucket = getStorage(getApp()).bucket();
  }
  return _bucket;
};
