import { type AppCheck, getAppCheck as fbGetAppCheck } from 'firebase-admin/app-check'

import { getApp } from './app.ts'

let _appCheck: AppCheck | undefined

export const getAppCheck = () => {
  if (!_appCheck) {
    _appCheck = fbGetAppCheck(getApp())
  }
  return _appCheck
}
