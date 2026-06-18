import {
  ConnectorConfig,
  DataConnect,
  ExecuteQueryOptions,
  MutationPromise,
  MutationRef,
  QueryPromise,
  QueryRef,
} from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;

export interface Chat_Key {
  id: string;
  __typename?: 'Chat_Key';
}

export interface Config_Key {
  id: string;
  __typename?: 'Config_Key';
}

export interface ListSaveSlotsData {
  saveSlots: ({
    id: string;
    slotNumber: number;
    lastLocationName?: string | null;
    playedTimeSeconds?: number | null;
    storageRef: string;
    createdAt?: DateString | null;
    updatedAt?: DateString | null;
  } & SaveSlot_Key)[];
}

export interface ListSaveSlotsVariables {
  uid: string;
}

export interface ListUsersData {
  users: ({
    id: string;
    email?: string | null;
  } & User_Key)[];
}

export interface Message_Key {
  id: string;
  __typename?: 'Message_Key';
}

export interface Notification_Key {
  id: string;
  __typename?: 'Notification_Key';
}

export interface Npc_Key {
  id: string;
  __typename?: 'Npc_Key';
}

export interface Persona_Key {
  id: string;
  __typename?: 'Persona_Key';
}

export interface SaveSlot_Key {
  id: string;
  __typename?: 'SaveSlot_Key';
}

export interface UpsertSaveSlotData {
  saveSlot_upsert: SaveSlot_Key;
}

export interface UpsertSaveSlotVariables {
  id: string;
  uid: string;
  slotNumber: number;
  lastLocationName?: string | null;
  playedTimeSeconds?: number | null;
  storageRef: string;
}

export interface User_Key {
  id: string;
  __typename?: 'User_Key';
}

export interface AudioTrack_Key {
  id: string;
  __typename?: 'AudioTrack_Key';
}

export interface GetTracksByMoodData {
  audioTracks: ({
    id: string;
    title: string;
    storageUrl: string;
  } & AudioTrack_Key)[];
}

export interface GetTracksByMoodVariables {
  mood: string;
}

interface ListUsersRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListUsersData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListUsersData, undefined>;
  operationName: string;
}
export const listUsersRef: ListUsersRef;

export function listUsers(options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;
export function listUsers(
  dc: DataConnect,
  options?: ExecuteQueryOptions,
): QueryPromise<ListUsersData, undefined>;

interface ListSaveSlotsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListSaveSlotsVariables): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (
    dc: DataConnect,
    vars: ListSaveSlotsVariables,
  ): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
  operationName: string;
}
export const listSaveSlotsRef: ListSaveSlotsRef;

export function listSaveSlots(
  vars: ListSaveSlotsVariables,
  options?: ExecuteQueryOptions,
): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;
export function listSaveSlots(
  dc: DataConnect,
  vars: ListSaveSlotsVariables,
  options?: ExecuteQueryOptions,
): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;

interface UpsertSaveSlotRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertSaveSlotVariables): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (
    dc: DataConnect,
    vars: UpsertSaveSlotVariables,
  ): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
  operationName: string;
}
export const upsertSaveSlotRef: UpsertSaveSlotRef;

interface GetTracksByMoodRef {
  (vars: GetTracksByMoodVariables): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
  (
    dc: DataConnect,
    vars: GetTracksByMoodVariables,
  ): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
  operationName: string;
}
export const getTracksByMoodRef: GetTracksByMoodRef;

export function getTracksByMood(
  vars: GetTracksByMoodVariables,
  options?: ExecuteQueryOptions,
): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;
export function getTracksByMood(
  dc: DataConnect,
  vars: GetTracksByMoodVariables,
  options?: ExecuteQueryOptions,
): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;

export function upsertSaveSlot(
  vars: UpsertSaveSlotVariables,
): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;
export function upsertSaveSlot(
  dc: DataConnect,
  vars: UpsertSaveSlotVariables,
): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;
