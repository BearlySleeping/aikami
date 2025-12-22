import { getMessaging } from 'firebase/messaging'
import app from './app.ts'
export { deleteToken, getToken, onMessage } from 'firebase/messaging'

export const messaging = getMessaging(app)
