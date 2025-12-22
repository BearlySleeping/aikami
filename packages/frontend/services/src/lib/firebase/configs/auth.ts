import { getAuth } from 'firebase/auth'
import app from './app.ts'

export {
  confirmPasswordReset as firebaseConfirmPasswordReset,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getIdToken,
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateEmail,
  updatePassword as firebaseUpdatePassword,
  updateProfile,
  verifyPasswordResetCode as firebaseVerifyPasswordResetCode,
} from 'firebase/auth'

export const auth = getAuth(app)
