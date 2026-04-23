// apps/frontend/gamejs/src/scenes/test/test.ts
import { Node } from 'godot';
import FirebaseAuth from '../../core/firebase_auth';
import { logger } from '../../utils/logger';

const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'asdasd';

export default class Test extends Node {
    _ready(): void {
        logger.debug('Test: _ready');
        this.run_auth_test();
    }

    private async run_auth_test(): Promise<void> {
        logger.debug('Test: run_auth_test');
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);

        if (!auth) {
            logger.error('Test: FirebaseAuth not available');
            this.quit_test();
            return;
        }

        logger.debug('Test: attempting sign in');
        const user = await auth.sign_in_with_email(TEST_EMAIL, TEST_PASSWORD);

        if (user) {
            logger.debug('Test: SIGNED IN!', JSON.stringify(user));
        } else {
            logger.debug('Test: sign in failed, trying sign up');
            const newUser = await auth.sign_up_with_email(TEST_EMAIL, TEST_PASSWORD);
            if (newUser) {
                logger.debug('Test: CREATED ACCOUNT!', JSON.stringify(newUser));
            } else {
                logger.error('Test: AUTH FAILED');
            }
        }

        this.quit_test();
    }

    private quit_test(): void {
        logger.debug('Test: quitting in 5 seconds');
        setTimeout(() => {
            this.get_tree().quit();
        }, 5000);
    }
}
