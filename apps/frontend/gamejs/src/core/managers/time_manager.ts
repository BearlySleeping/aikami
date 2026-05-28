// apps/frontend/gamejs/src/core/managers/time_manager.ts
/**
 * In-game clock and calendar system.
 * Converts real-time seconds into in-game minutes/hours/days
 * starting from a fixed date (February 18, 1030).
 *
 * Persists total in-game hours via ConfigManager.
 */
import { Node } from 'godot';
import ConfigManager from './config_manager';
import { logger } from '../../utils/logger';

const START_YEAR = 1030;
const START_MONTH = 2; // February
const START_DAY = 18;

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const DAYS_IN_MONTH = 30;
const IN_GAME_TO_REAL_MINUTE_DURATION = (2 * Math.PI) / MINUTES_PER_DAY;

const TIME_SPEED = 0.25;
const SAVE_FREQUENCY_IN_GAME_MINUTES = 10;

const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/**
 * Snapshot of the current in-game time.
 */
export type TimeModel = {
    day: number;
    hour: number;
    minute: number;
    totalInGameMinutes: number;
};

export type TimeManagerOptions = {
    running?: boolean;
};

/**
 * Drives the in-game clock and calendar.
 */
export default class TimeManager extends Node {
    private static _instance: TimeManager | null = null;

    private _totalDeltaTime: number = IN_GAME_TO_REAL_MINUTE_DURATION * MINUTES_PER_HOUR;
    private _running: boolean = false;
    private _totalInGameMinutes: number = 0;
    private _lastSavedMinute: number = -1;

    static get instance(): TimeManager | null {
        return TimeManager._instance;
    }

    _ready(): void {
        logger.debug('TimeManager._ready');
        TimeManager._instance = this;
        (globalThis as Record<string, unknown>).timeManagerInstance = this;
        this._loadSavedTime();
    }

    _process(delta: number): void {
        if (!this._running) {
            return;
        }

        this._totalDeltaTime += delta * IN_GAME_TO_REAL_MINUTE_DURATION * TIME_SPEED;
        const newTime = this.getTotalGameTime();

        if (this._totalInGameMinutes === newTime.totalInGameMinutes) {
            return;
        }

        this._totalInGameMinutes = newTime.totalInGameMinutes;
        logger.debug('TimeManager._process', newTime);

        if (
            this._totalInGameMinutes % SAVE_FREQUENCY_IN_GAME_MINUTES === 0 &&
            this._totalInGameMinutes !== this._lastSavedMinute
        ) {
            this._lastSavedMinute = this._totalInGameMinutes;
            this._saveTime();
        }
    }

    /**
     * Start or stop the in-game clock.
     */
    setRunning(value: boolean): void {
        logger.debug('TimeManager.setRunning', value);
        this._running = value;
    }

    get running(): boolean {
        return this._running;
    }

    /**
     * Get the total elapsed in-game minutes since epoch.
     */
    getTotalInGameMinutes(): number {
        return Math.floor(this._totalDeltaTime / IN_GAME_TO_REAL_MINUTE_DURATION);
    }

    /**
     * Get a TimeModel snapshot of the current game time.
     */
    getTotalGameTime(): TimeModel {
        const totalMinutes = this.getTotalInGameMinutes();
        return {
            day: Math.floor(totalMinutes / MINUTES_PER_DAY),
            hour: Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR),
            minute: totalMinutes % MINUTES_PER_HOUR,
            totalInGameMinutes: totalMinutes,
        };
    }

    /**
     * Convert a time difference (in in-game minutes) to a human-readable string.
     */
    toCurrentTimeDifference(inGameMinute: number): string {
        const difference = this.getTotalInGameMinutes() - inGameMinute;
        if (difference < 60) {
            return `${difference} minutes ago`;
        }
        if (difference < MINUTES_PER_DAY) {
            return `${Math.floor(difference / MINUTES_PER_HOUR)} hour(s) ago`;
        }
        if (difference < MINUTES_PER_DAY * 7) {
            return `${Math.floor(difference / MINUTES_PER_DAY)} day(s) ago`;
        }
        return `${Math.floor(difference / (MINUTES_PER_DAY * 7))} week(s) ago`;
    }

    /**
     * Convert a TimeModel to a calendar date string.
     * Based on constant start date 18.02.1030.
     * @example day 3, hour 8, minute 30 => "21 of February 1030, 08:30"
     */
    toCalendar(time: TimeModel): string {
        const totalDays = START_DAY + time.day;
        const monthsPassed = Math.floor(totalDays / DAYS_IN_MONTH);
        let currentDay = totalDays % DAYS_IN_MONTH;
        let currentMonth = ((START_MONTH + monthsPassed - 1) % 12) + 1;
        const yearsPassed = Math.floor((START_MONTH + monthsPassed - 1) / 12);
        const currentYear = START_YEAR + yearsPassed;

        if (currentDay === 0) {
            currentDay = DAYS_IN_MONTH;
            currentMonth -= 1;
        }
        if (currentMonth === 0) {
            currentMonth = 12;
        }

        const hourStr = time.hour.toString().padStart(2, '0');
        const minuteStr = time.minute.toString().padStart(2, '0');
        const monthName = MONTH_NAMES[currentMonth - 1];

        return `${currentDay} of ${monthName} ${currentYear}, ${hourStr}:${minuteStr}`;
    }

    private _loadSavedTime(): void {
        const config = ConfigManager.instance;
        const savedHours = config?.get_value(ConfigManager.ConfigKey.TIME_TOTAL_HOURS) as number;
        if (savedHours && savedHours > 0) {
            this._totalDeltaTime = IN_GAME_TO_REAL_MINUTE_DURATION * MINUTES_PER_HOUR * savedHours;
            logger.debug('TimeManager._loadSavedTime', { savedHours });
        }
    }

    private _saveTime(): void {
        const totalHours = this._totalInGameMinutes / MINUTES_PER_HOUR;
        const config = ConfigManager.instance;
        config?.set_value(ConfigManager.ConfigKey.TIME_TOTAL_HOURS, totalHours);
        logger.debug('TimeManager._saveTime', { totalHours });
    }
}

export { TimeManager };
