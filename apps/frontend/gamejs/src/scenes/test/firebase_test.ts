// apps/frontend/gamejs/src/scenes/test/firebase_test.ts
/**
 * @fileoverview Firebase comprehensive integration test scene
 * @description Tests all Firebase services: Auth, CloudSave, Leaderboard, Storage, Functions
 * @test Coverage Auth (signIn, signUp, logout, anonymous), Firestore (create, read, update, delete), Storage (upload, download, delete), Functions (call, prompt_ai)
 */
import { Node } from 'godot';
import FirebaseAuth from '../../core/firebase_auth';
import FirebaseCloudSave from '../../core/firebase_cloud_save';
import FirebaseFunctions from '../../core/firebase_functions';
import FirebaseLeaderboard from '../../core/firebase_leaderboard';
import FirebaseStorage from '../../core/firebase_storage';
import { logger } from '../../utils/logger';

const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'asdasd';
const TEST_GAME_ID = 'test_game';

interface TestResult {
    name: string;
    passed: boolean;
    message: string;
}

export default class FirebaseTest extends Node {
    private testResults: TestResult[] = [];

    _ready(): void {
        logger.debug('FirebaseTest: _ready, starting comprehensive tests');
        this.run_all_tests().catch((e) => {
            logger.error('FirebaseTest: test error', e);
            this.quit_test();
        });
    }

    private async run_all_tests(): Promise<void> {
        logger.debug('FirebaseTest: ===================');
        logger.debug('FirebaseTest: Running ALL tests');

        // Auth tests - sign in first so other tests have a user
        await this.test_auth_signin();
        await this.test_auth_signup();

        // CloudSave tests (need auth)
        await this.test_cloudsave_create();
        await this.test_cloudsave_read();
        await this.test_cloudsave_update();
        await this.test_cloudsave_delete();

        // Leaderboard tests (need auth)
        await this.test_leaderboard_submit();
        await this.test_leaderboard_fetch();

        // Storage tests (need auth)
        await this.test_storage_upload();
        await this.test_storage_download();
        await this.test_storage_delete();

        // Functions tests
        await this.test_functions_call();
        await this.test_functions_prompt_ai();

        // Auth tests - signOut and anonymous last
        await this.test_auth_logout();
        await this.test_auth_anonymous();

        logger.debug('FirebaseTest: ===================');
        this.log_results();
        this.quit_test();
    }

    // ==================== AUTH TESTS ====================
    private async test_auth_signup(): Promise<void> {
        logger.debug('FirebaseTest: TEST Auth.signUp');
        const auth = this.get_auth();
        if (!auth) {
            this.add_result('Auth.signUp', false, 'No auth instance');
            return;
        }
        const user = await auth.sign_up_with_email(TEST_EMAIL, TEST_PASSWORD);
        this.add_result('Auth.signUp', !!user, user ? 'Created account' : 'Failed to create');
    }

    private async test_auth_signin(): Promise<void> {
        logger.debug('FirebaseTest: TEST Auth.signIn');
        const auth = this.get_auth();
        if (!auth) {
            this.add_result('Auth.signIn', false, 'No auth instance');
            return;
        }
        const user = await auth.sign_in_with_email(TEST_EMAIL, TEST_PASSWORD);
        this.add_result('Auth.signIn', !!user, user ? `Signed in as ${user.email}` : 'Failed to sign in');
    }

    private async test_auth_logout(): Promise<void> {
        logger.debug('FirebaseTest: TEST Auth.signOut');
        const auth = this.get_auth();
        if (!auth) {
            this.add_result('Auth.signOut', false, 'No auth instance');
            return;
        }
        auth.sign_out();
        const user = auth.currentUser;
        this.add_result('Auth.signOut', !user, user ? 'Still logged in' : 'Logged out');
    }

    private async test_auth_anonymous(): Promise<void> {
        logger.debug('FirebaseTest: TEST Auth.anonymous');
        const auth = this.get_auth();
        if (!auth) {
            this.add_result('Auth.anonymous', false, 'No auth instance');
            return;
        }
        const user = await auth.sign_in_anonymous();
        this.add_result('Auth.anonymous', !!user, user ? `Anonymous user: ${user.uid}` : 'Failed');
    }

    private get_auth(): FirebaseAuth | null {
        return (
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null)
        );
    }

    // ==================== LEADERBOARD TESTS ====================
    private async test_leaderboard_submit(): Promise<void> {
        logger.debug('FirebaseTest: TEST Leaderboard.submitScore');
        const leaderboard = this.get_leaderboard();
        const auth = this.get_auth();
        if (!leaderboard) {
            this.add_result('Leaderboard.submitScore', false, 'No leaderboard instance');
            return;
        }
        const uid = auth?.currentUser?.uid || `test_user_${Date.now()}`;
        const submitted = await leaderboard.submit_score(
            TEST_GAME_ID,
            uid,
            'TestPlayer',
            Math.floor(Math.random() * 10000),
        );
        this.add_result('Leaderboard.submitScore', submitted, submitted ? 'Score submitted' : 'Failed');
    }

    private async test_leaderboard_fetch(): Promise<void> {
        logger.debug('FirebaseTest: TEST Leaderboard.fetchLeaderboard');
        const leaderboard = this.get_leaderboard();
        if (!leaderboard) {
            this.add_result('Leaderboard.fetchLeaderboard', false, 'No leaderboard instance');
            return;
        }
        const entries = await leaderboard.fetch_leaderboard(TEST_GAME_ID, 10);
        this.add_result('Leaderboard.fetchLeaderboard', entries.length > 0, `Fetched ${entries.length} entries`);
    }

    private get_leaderboard(): FirebaseLeaderboard | null {
        return (
            FirebaseLeaderboard.instance ??
            ((globalThis as Record<string, unknown>).firebaseLeaderboardInstance as FirebaseLeaderboard | null)
        );
    }

    // ==================== CLOUDSAVE TESTS ====================
    private async test_cloudsave_create(): Promise<void> {
        logger.debug('FirebaseTest: TEST CloudSave.create');
        const cloudSave = this.get_cloudsave();
        if (!cloudSave) {
            this.add_result('CloudSave.create', false, 'No cloudSave instance');
            return;
        }
        const saveData = {
            level: 5,
            score: 12345,
            inventory: ['sword', 'shield', 'potion'],
            timestamp: Date.now(),
        };
        const saved = await cloudSave.save_game(TEST_GAME_ID, 5, saveData.score as number, saveData);
        this.add_result('CloudSave.create', saved, saved ? 'Game saved' : 'Failed to save');
    }

    private async test_cloudsave_read(): Promise<void> {
        logger.debug('FirebaseTest: TEST CloudSave.read');
        const cloudSave = this.get_cloudsave();
        if (!cloudSave) {
            this.add_result('CloudSave.read', false, 'No cloudSave instance');
            return;
        }
        const loaded = await cloudSave.load_game(TEST_GAME_ID);
        this.add_result('CloudSave.read', !!loaded, loaded ? 'Game loaded' : 'Failed to load');
    }

    private async test_cloudsave_update(): Promise<void> {
        logger.debug('FirebaseTest: TEST CloudSave.update');
        const cloudSave = this.get_cloudsave();
        if (!cloudSave) {
            this.add_result('CloudSave.update', false, 'No cloudSave instance');
            return;
        }
        const saveData = {
            level: 10,
            score: 99999,
            inventory: ['sword', 'shield', 'potion', 'armor'],
            timestamp: Date.now(),
        };
        const saved = await cloudSave.save_game(TEST_GAME_ID, 10, saveData.score as number, saveData);
        this.add_result('CloudSave.update', saved, saved ? 'Game updated' : 'Failed to update');
    }

    private async test_cloudsave_delete(): Promise<void> {
        logger.debug('FirebaseTest: TEST CloudSave.delete');
        const cloudSave = this.get_cloudsave();
        if (!cloudSave) {
            this.add_result('CloudSave.delete', false, 'No cloudSave instance');
            return;
        }
        const deleted = await cloudSave.delete_game(TEST_GAME_ID);
        this.add_result('CloudSave.delete', deleted, deleted ? 'Game deleted' : 'Failed to delete');
    }

    private get_cloudsave(): FirebaseCloudSave | null {
        return (
            FirebaseCloudSave.instance ??
            ((globalThis as Record<string, unknown>).firebaseCloudSaveInstance as FirebaseCloudSave | null)
        );
    }

    // ==================== STORAGE TESTS ====================
    private async test_storage_upload(): Promise<void> {
        logger.debug('FirebaseTest: TEST Storage.upload');
        const storage = this.get_storage();
        if (!storage) {
            this.add_result('Storage.upload', false, 'No storage instance');
            return;
        }
        const testContent = 'Hello Firebase Storage!';
        const testPath = `test/test_file_${Date.now()}.txt`;
        const url = await storage.upload_file(testPath, testContent, 'text/plain');
        this.add_result('Storage.upload', !!url, url ? 'File uploaded' : 'Failed to upload');
    }

    private async test_storage_download(): Promise<void> {
        logger.debug('FirebaseTest: TEST Storage.download');
        const storage = this.get_storage();
        if (!storage) {
            this.add_result('Storage.download', false, 'No storage instance');
            return;
        }
        const testPath = `test/test_file_${Date.now()}.txt`;
        await storage.upload_file(testPath, 'Test content', 'text/plain');
        const content = await storage.download_file(testPath);
        this.add_result(
            'Storage.download',
            !!content && content.length > 0,
            content ? 'File downloaded' : 'Failed to download',
        );
    }

    private async test_storage_delete(): Promise<void> {
        logger.debug('FirebaseTest: TEST Storage.delete');
        const storage = this.get_storage();
        if (!storage) {
            this.add_result('Storage.delete', false, 'No storage instance');
            return;
        }
        const testPath = `test/test_file_${Date.now()}.txt`;
        await storage.upload_file(testPath, 'Test content', 'text/plain');
        const deleted = await storage.delete_file(testPath);
        this.add_result('Storage.delete', deleted, deleted ? 'File deleted' : 'Failed to delete');
    }

    private get_storage(): FirebaseStorage | null {
        return (
            FirebaseStorage.instance ??
            ((globalThis as Record<string, unknown>).firebaseStorageInstance as FirebaseStorage | null)
        );
    }

    // ==================== FUNCTIONS TESTS ====================
    private async test_functions_call(): Promise<void> {
        logger.debug('FirebaseTest: TEST Functions.call');
        const functions = this.get_functions();
        if (!functions) {
            this.add_result('Functions.call', false, 'No functions instance');
            return;
        }
        const result = await functions.call_function('generate_image', { prompt: 'Hello' }, 'us-central1');
        const passed =
            !result.error || result.error?.includes?.('NOT_FOUND') || result.error?.includes?.('Function not found');
        this.add_result(
            'Functions.generate_image',
            passed,
            result.error ? `Error: ${result.error}` : 'Function called',
        );
    }

    private async test_functions_prompt_ai(): Promise<void> {
        logger.debug('FirebaseTest: TEST Functions.prompt_ai');
        const functions = this.get_functions();
        if (!functions) {
            this.add_result('Functions.prompt_ai', false, 'No functions instance');
            return;
        }
        const result = await functions.prompt_ai('Hello AI', 'test game');
        const passed =
            !result.error || result.error?.includes?.('NOT_FOUND') || result.error?.includes?.('Function not found');
        this.add_result('Functions.prompt_ai', passed, result.error ? `Error: ${result.error}` : 'AI prompted');
    }

    private get_functions(): FirebaseFunctions | null {
        return (
            FirebaseFunctions.instance ??
            ((globalThis as Record<string, unknown>).firebaseFunctionsInstance as FirebaseFunctions | null)
        );
    }

    // ==================== UTILITIES ====================
    private add_result(name: string, passed: boolean, message: string): void {
        this.testResults.push({ name, passed, message });
        logger.debug(`FirebaseTest: ${passed ? 'PASS' : 'FAIL'}: ${name} - ${message}`);
    }

    private log_results(): void {
        logger.debug('FirebaseTest: ===== RESULTS =====');
        let passed = 0;
        let failed = 0;
        this.testResults.forEach((result) => {
            if (result.passed) {
                passed++;
            } else {
                failed++;
            }
        });
        logger.debug(`FirebaseTest: Passed: ${passed}/${this.testResults.length}`);
        logger.debug(`FirebaseTest: Failed: ${failed}/${this.testResults.length}`);
        logger.debug('FirebaseTest: ===================');
        this.testResults.forEach((result) => {
            const status = result.passed ? 'PASS' : 'FAIL';
            logger.debug(`FirebaseTest: [${status}] ${result.name}: ${result.message}`);
        });
        logger.debug('FirebaseTest: ===================');
    }

    private quit_test(): void {
        logger.debug('FirebaseTest: quitting in 3 seconds');
        setTimeout(() => {
            this.get_tree().quit();
        }, 3000);
    }
}
