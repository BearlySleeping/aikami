import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface ActivatePersonaData {
  persona_updateMany: number;
}

export interface ActivatePersonaVariables {
  id: string;
  uid: string;
}

export interface AudioTrack_Key {
  id: UUIDString;
  __typename?: 'AudioTrack_Key';
}

export interface Chat_Key {
  id: string;
  __typename?: 'Chat_Key';
}

export interface Config_Key {
  id: string;
  __typename?: 'Config_Key';
}

export interface CreatePersonaData {
  persona_insert: Persona_Key;
}

export interface CreatePersonaVariables {
  id: string;
  uid: string;
  name: string;
  avatarUrl?: string | null;
  voiceConfigId?: string | null;
  traits?: unknown | null;
  isActive: boolean;
}

export interface DeactivatePersonasData {
  persona_updateMany: number;
}

export interface DeactivatePersonasVariables {
  uid: string;
}

export interface DeletePersonaData {
  persona_deleteMany: number;
}

export interface DeletePersonaVariables {
  id: string;
  uid: string;
}

export interface GetPersonaData {
  personas: ({
    id: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
    name: string;
    description?: string | null;
    avatarUrl?: string | null;
    uid: string;
    traits?: unknown | null;
    isActive: boolean;
    voiceConfigId?: string | null;
  } & Persona_Key)[];
}

export interface GetPersonaVariables {
  id: string;
  uid: string;
}

export interface GetTracksByMoodData {
  audioTracks: ({
    id: UUIDString;
    title: string;
    storageUrl: string;
  } & AudioTrack_Key)[];
}

export interface GetTracksByMoodVariables {
  mood: string;
}

export interface ListPersonasData {
  personas: ({
    id: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
    name: string;
    description?: string | null;
    avatarUrl?: string | null;
    uid: string;
    traits?: unknown | null;
    isActive: boolean;
    voiceConfigId?: string | null;
  } & Persona_Key)[];
}

export interface ListPersonasVariables {
  uid: string;
}

export interface ListSaveSlotsData {
  saveSlots: ({
    id: string;
    slotNumber: number;
    lastLocationName?: string | null;
    playedTimeSeconds?: number | null;
    storageRef: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & SaveSlot_Key)[];
}

export interface ListSaveSlotsVariables {
  uid: string;
}

export interface ListUsersData {
  users: ({
    id: string;
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

export interface UpdatePersonaData {
  persona_updateMany: number;
}

export interface UpdatePersonaVariables {
  id: string;
  uid: string;
  name?: string | null;
  avatarUrl?: string | null;
  voiceConfigId?: string | null;
  traits?: unknown | null;
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

interface ListUsersRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListUsersData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListUsersData, undefined>;
  operationName: string;
}
export const listUsersRef: ListUsersRef;

export function listUsers(options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;
export function listUsers(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;

interface GetTracksByMoodRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetTracksByMoodVariables): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetTracksByMoodVariables): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
  operationName: string;
}
export const getTracksByMoodRef: GetTracksByMoodRef;

export function getTracksByMood(vars: GetTracksByMoodVariables, options?: ExecuteQueryOptions): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;
export function getTracksByMood(dc: DataConnect, vars: GetTracksByMoodVariables, options?: ExecuteQueryOptions): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;

interface ListSaveSlotsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListSaveSlotsVariables): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ListSaveSlotsVariables): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
  operationName: string;
}
export const listSaveSlotsRef: ListSaveSlotsRef;

export function listSaveSlots(vars: ListSaveSlotsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;
export function listSaveSlots(dc: DataConnect, vars: ListSaveSlotsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;

interface UpsertSaveSlotRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertSaveSlotVariables): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpsertSaveSlotVariables): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
  operationName: string;
}
export const upsertSaveSlotRef: UpsertSaveSlotRef;

export function upsertSaveSlot(vars: UpsertSaveSlotVariables): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;
export function upsertSaveSlot(dc: DataConnect, vars: UpsertSaveSlotVariables): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;

interface ListPersonasRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListPersonasVariables): QueryRef<ListPersonasData, ListPersonasVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ListPersonasVariables): QueryRef<ListPersonasData, ListPersonasVariables>;
  operationName: string;
}
export const listPersonasRef: ListPersonasRef;

export function listPersonas(vars: ListPersonasVariables, options?: ExecuteQueryOptions): QueryPromise<ListPersonasData, ListPersonasVariables>;
export function listPersonas(dc: DataConnect, vars: ListPersonasVariables, options?: ExecuteQueryOptions): QueryPromise<ListPersonasData, ListPersonasVariables>;

interface GetPersonaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaVariables): QueryRef<GetPersonaData, GetPersonaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetPersonaVariables): QueryRef<GetPersonaData, GetPersonaVariables>;
  operationName: string;
}
export const getPersonaRef: GetPersonaRef;

export function getPersona(vars: GetPersonaVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaData, GetPersonaVariables>;
export function getPersona(dc: DataConnect, vars: GetPersonaVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaData, GetPersonaVariables>;

interface CreatePersonaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaVariables): MutationRef<CreatePersonaData, CreatePersonaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreatePersonaVariables): MutationRef<CreatePersonaData, CreatePersonaVariables>;
  operationName: string;
}
export const createPersonaRef: CreatePersonaRef;

export function createPersona(vars: CreatePersonaVariables): MutationPromise<CreatePersonaData, CreatePersonaVariables>;
export function createPersona(dc: DataConnect, vars: CreatePersonaVariables): MutationPromise<CreatePersonaData, CreatePersonaVariables>;

interface UpdatePersonaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdatePersonaVariables): MutationRef<UpdatePersonaData, UpdatePersonaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdatePersonaVariables): MutationRef<UpdatePersonaData, UpdatePersonaVariables>;
  operationName: string;
}
export const updatePersonaRef: UpdatePersonaRef;

export function updatePersona(vars: UpdatePersonaVariables): MutationPromise<UpdatePersonaData, UpdatePersonaVariables>;
export function updatePersona(dc: DataConnect, vars: UpdatePersonaVariables): MutationPromise<UpdatePersonaData, UpdatePersonaVariables>;

interface DeletePersonaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeletePersonaVariables): MutationRef<DeletePersonaData, DeletePersonaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeletePersonaVariables): MutationRef<DeletePersonaData, DeletePersonaVariables>;
  operationName: string;
}
export const deletePersonaRef: DeletePersonaRef;

export function deletePersona(vars: DeletePersonaVariables): MutationPromise<DeletePersonaData, DeletePersonaVariables>;
export function deletePersona(dc: DataConnect, vars: DeletePersonaVariables): MutationPromise<DeletePersonaData, DeletePersonaVariables>;

interface DeactivatePersonasRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeactivatePersonasVariables): MutationRef<DeactivatePersonasData, DeactivatePersonasVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeactivatePersonasVariables): MutationRef<DeactivatePersonasData, DeactivatePersonasVariables>;
  operationName: string;
}
export const deactivatePersonasRef: DeactivatePersonasRef;

export function deactivatePersonas(vars: DeactivatePersonasVariables): MutationPromise<DeactivatePersonasData, DeactivatePersonasVariables>;
export function deactivatePersonas(dc: DataConnect, vars: DeactivatePersonasVariables): MutationPromise<DeactivatePersonasData, DeactivatePersonasVariables>;

interface ActivatePersonaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ActivatePersonaVariables): MutationRef<ActivatePersonaData, ActivatePersonaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ActivatePersonaVariables): MutationRef<ActivatePersonaData, ActivatePersonaVariables>;
  operationName: string;
}
export const activatePersonaRef: ActivatePersonaRef;

export function activatePersona(vars: ActivatePersonaVariables): MutationPromise<ActivatePersonaData, ActivatePersonaVariables>;
export function activatePersona(dc: DataConnect, vars: ActivatePersonaVariables): MutationPromise<ActivatePersonaData, ActivatePersonaVariables>;

