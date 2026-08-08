# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `aikami-connector`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*ListUsers*](#listusers)
  - [*GetTracksByMood*](#gettracksbymood)
  - [*ListSaveSlots*](#listsaveslots)
  - [*ListPersonas*](#listpersonas)
  - [*GetPersona*](#getpersona)
- [**Mutations**](#mutations)
  - [*UpsertSaveSlot*](#upsertsaveslot)
  - [*CreatePersona*](#createpersona)
  - [*UpdatePersona*](#updatepersona)
  - [*DeletePersona*](#deletepersona)
  - [*DeactivatePersonas*](#deactivatepersonas)
  - [*ActivatePersona*](#activatepersona)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `aikami-connector`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@aikami/frontend-dataconnect` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@aikami/frontend-dataconnect';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@aikami/frontend-dataconnect';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `aikami-connector` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## ListUsers
You can execute the `ListUsers` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
listUsers(options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;

interface ListUsersRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListUsersData, undefined>;
}
export const listUsersRef: ListUsersRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listUsers(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;

interface ListUsersRef {
  ...
  (dc: DataConnect): QueryRef<ListUsersData, undefined>;
}
export const listUsersRef: ListUsersRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listUsersRef:
```typescript
const name = listUsersRef.operationName;
console.log(name);
```

### Variables
The `ListUsers` query has no variables.
### Return Type
Recall that executing the `ListUsers` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListUsersData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ListUsersData {
  users: ({
    id: string;
  } & User_Key)[];
}
```
### Using `ListUsers`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listUsers } from '@aikami/frontend-dataconnect';


// Call the `listUsers()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listUsers();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listUsers(dataConnect);

console.log(data.users);

// Or, you can use the `Promise` API.
listUsers().then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

### Using `ListUsers`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listUsersRef } from '@aikami/frontend-dataconnect';


// Call the `listUsersRef()` function to get a reference to the query.
const ref = listUsersRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listUsersRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.users);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

## GetTracksByMood
You can execute the `GetTracksByMood` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
getTracksByMood(vars: GetTracksByMoodVariables, options?: ExecuteQueryOptions): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;

interface GetTracksByMoodRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetTracksByMoodVariables): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
}
export const getTracksByMoodRef: GetTracksByMoodRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getTracksByMood(dc: DataConnect, vars: GetTracksByMoodVariables, options?: ExecuteQueryOptions): QueryPromise<GetTracksByMoodData, GetTracksByMoodVariables>;

interface GetTracksByMoodRef {
  ...
  (dc: DataConnect, vars: GetTracksByMoodVariables): QueryRef<GetTracksByMoodData, GetTracksByMoodVariables>;
}
export const getTracksByMoodRef: GetTracksByMoodRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getTracksByMoodRef:
```typescript
const name = getTracksByMoodRef.operationName;
console.log(name);
```

### Variables
The `GetTracksByMood` query requires an argument of type `GetTracksByMoodVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetTracksByMoodVariables {
  mood: string;
}
```
### Return Type
Recall that executing the `GetTracksByMood` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetTracksByMoodData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetTracksByMoodData {
  audioTracks: ({
    id: UUIDString;
    title: string;
    storageUrl: string;
  } & AudioTrack_Key)[];
}
```
### Using `GetTracksByMood`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getTracksByMood, GetTracksByMoodVariables } from '@aikami/frontend-dataconnect';

// The `GetTracksByMood` query requires an argument of type `GetTracksByMoodVariables`:
const getTracksByMoodVars: GetTracksByMoodVariables = {
  mood: ..., 
};

// Call the `getTracksByMood()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getTracksByMood(getTracksByMoodVars);
// Variables can be defined inline as well.
const { data } = await getTracksByMood({ mood: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getTracksByMood(dataConnect, getTracksByMoodVars);

console.log(data.audioTracks);

// Or, you can use the `Promise` API.
getTracksByMood(getTracksByMoodVars).then((response) => {
  const data = response.data;
  console.log(data.audioTracks);
});
```

### Using `GetTracksByMood`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getTracksByMoodRef, GetTracksByMoodVariables } from '@aikami/frontend-dataconnect';

// The `GetTracksByMood` query requires an argument of type `GetTracksByMoodVariables`:
const getTracksByMoodVars: GetTracksByMoodVariables = {
  mood: ..., 
};

// Call the `getTracksByMoodRef()` function to get a reference to the query.
const ref = getTracksByMoodRef(getTracksByMoodVars);
// Variables can be defined inline as well.
const ref = getTracksByMoodRef({ mood: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getTracksByMoodRef(dataConnect, getTracksByMoodVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.audioTracks);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.audioTracks);
});
```

## ListSaveSlots
You can execute the `ListSaveSlots` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
listSaveSlots(vars: ListSaveSlotsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;

interface ListSaveSlotsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListSaveSlotsVariables): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
}
export const listSaveSlotsRef: ListSaveSlotsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listSaveSlots(dc: DataConnect, vars: ListSaveSlotsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSaveSlotsData, ListSaveSlotsVariables>;

interface ListSaveSlotsRef {
  ...
  (dc: DataConnect, vars: ListSaveSlotsVariables): QueryRef<ListSaveSlotsData, ListSaveSlotsVariables>;
}
export const listSaveSlotsRef: ListSaveSlotsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listSaveSlotsRef:
```typescript
const name = listSaveSlotsRef.operationName;
console.log(name);
```

### Variables
The `ListSaveSlots` query requires an argument of type `ListSaveSlotsVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListSaveSlotsVariables {
  uid: string;
}
```
### Return Type
Recall that executing the `ListSaveSlots` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListSaveSlotsData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListSaveSlots`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listSaveSlots, ListSaveSlotsVariables } from '@aikami/frontend-dataconnect';

// The `ListSaveSlots` query requires an argument of type `ListSaveSlotsVariables`:
const listSaveSlotsVars: ListSaveSlotsVariables = {
  uid: ..., 
};

// Call the `listSaveSlots()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listSaveSlots(listSaveSlotsVars);
// Variables can be defined inline as well.
const { data } = await listSaveSlots({ uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listSaveSlots(dataConnect, listSaveSlotsVars);

console.log(data.saveSlots);

// Or, you can use the `Promise` API.
listSaveSlots(listSaveSlotsVars).then((response) => {
  const data = response.data;
  console.log(data.saveSlots);
});
```

### Using `ListSaveSlots`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listSaveSlotsRef, ListSaveSlotsVariables } from '@aikami/frontend-dataconnect';

// The `ListSaveSlots` query requires an argument of type `ListSaveSlotsVariables`:
const listSaveSlotsVars: ListSaveSlotsVariables = {
  uid: ..., 
};

// Call the `listSaveSlotsRef()` function to get a reference to the query.
const ref = listSaveSlotsRef(listSaveSlotsVars);
// Variables can be defined inline as well.
const ref = listSaveSlotsRef({ uid: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listSaveSlotsRef(dataConnect, listSaveSlotsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.saveSlots);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.saveSlots);
});
```

## ListPersonas
You can execute the `ListPersonas` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
listPersonas(vars: ListPersonasVariables, options?: ExecuteQueryOptions): QueryPromise<ListPersonasData, ListPersonasVariables>;

interface ListPersonasRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListPersonasVariables): QueryRef<ListPersonasData, ListPersonasVariables>;
}
export const listPersonasRef: ListPersonasRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listPersonas(dc: DataConnect, vars: ListPersonasVariables, options?: ExecuteQueryOptions): QueryPromise<ListPersonasData, ListPersonasVariables>;

interface ListPersonasRef {
  ...
  (dc: DataConnect, vars: ListPersonasVariables): QueryRef<ListPersonasData, ListPersonasVariables>;
}
export const listPersonasRef: ListPersonasRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listPersonasRef:
```typescript
const name = listPersonasRef.operationName;
console.log(name);
```

### Variables
The `ListPersonas` query requires an argument of type `ListPersonasVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListPersonasVariables {
  uid: string;
}
```
### Return Type
Recall that executing the `ListPersonas` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListPersonasData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListPersonas`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listPersonas, ListPersonasVariables } from '@aikami/frontend-dataconnect';

// The `ListPersonas` query requires an argument of type `ListPersonasVariables`:
const listPersonasVars: ListPersonasVariables = {
  uid: ..., 
};

// Call the `listPersonas()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listPersonas(listPersonasVars);
// Variables can be defined inline as well.
const { data } = await listPersonas({ uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listPersonas(dataConnect, listPersonasVars);

console.log(data.personas);

// Or, you can use the `Promise` API.
listPersonas(listPersonasVars).then((response) => {
  const data = response.data;
  console.log(data.personas);
});
```

### Using `ListPersonas`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listPersonasRef, ListPersonasVariables } from '@aikami/frontend-dataconnect';

// The `ListPersonas` query requires an argument of type `ListPersonasVariables`:
const listPersonasVars: ListPersonasVariables = {
  uid: ..., 
};

// Call the `listPersonasRef()` function to get a reference to the query.
const ref = listPersonasRef(listPersonasVars);
// Variables can be defined inline as well.
const ref = listPersonasRef({ uid: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listPersonasRef(dataConnect, listPersonasVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personas);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personas);
});
```

## GetPersona
You can execute the `GetPersona` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
getPersona(vars: GetPersonaVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaData, GetPersonaVariables>;

interface GetPersonaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetPersonaVariables): QueryRef<GetPersonaData, GetPersonaVariables>;
}
export const getPersonaRef: GetPersonaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getPersona(dc: DataConnect, vars: GetPersonaVariables, options?: ExecuteQueryOptions): QueryPromise<GetPersonaData, GetPersonaVariables>;

interface GetPersonaRef {
  ...
  (dc: DataConnect, vars: GetPersonaVariables): QueryRef<GetPersonaData, GetPersonaVariables>;
}
export const getPersonaRef: GetPersonaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getPersonaRef:
```typescript
const name = getPersonaRef.operationName;
console.log(name);
```

### Variables
The `GetPersona` query requires an argument of type `GetPersonaVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetPersonaVariables {
  id: string;
  uid: string;
}
```
### Return Type
Recall that executing the `GetPersona` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetPersonaData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetPersona`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getPersona, GetPersonaVariables } from '@aikami/frontend-dataconnect';

// The `GetPersona` query requires an argument of type `GetPersonaVariables`:
const getPersonaVars: GetPersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `getPersona()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getPersona(getPersonaVars);
// Variables can be defined inline as well.
const { data } = await getPersona({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getPersona(dataConnect, getPersonaVars);

console.log(data.personas);

// Or, you can use the `Promise` API.
getPersona(getPersonaVars).then((response) => {
  const data = response.data;
  console.log(data.personas);
});
```

### Using `GetPersona`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getPersonaRef, GetPersonaVariables } from '@aikami/frontend-dataconnect';

// The `GetPersona` query requires an argument of type `GetPersonaVariables`:
const getPersonaVars: GetPersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `getPersonaRef()` function to get a reference to the query.
const ref = getPersonaRef(getPersonaVars);
// Variables can be defined inline as well.
const ref = getPersonaRef({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getPersonaRef(dataConnect, getPersonaVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.personas);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.personas);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `aikami-connector` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## UpsertSaveSlot
You can execute the `UpsertSaveSlot` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
upsertSaveSlot(vars: UpsertSaveSlotVariables): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;

interface UpsertSaveSlotRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertSaveSlotVariables): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
}
export const upsertSaveSlotRef: UpsertSaveSlotRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
upsertSaveSlot(dc: DataConnect, vars: UpsertSaveSlotVariables): MutationPromise<UpsertSaveSlotData, UpsertSaveSlotVariables>;

interface UpsertSaveSlotRef {
  ...
  (dc: DataConnect, vars: UpsertSaveSlotVariables): MutationRef<UpsertSaveSlotData, UpsertSaveSlotVariables>;
}
export const upsertSaveSlotRef: UpsertSaveSlotRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the upsertSaveSlotRef:
```typescript
const name = upsertSaveSlotRef.operationName;
console.log(name);
```

### Variables
The `UpsertSaveSlot` mutation requires an argument of type `UpsertSaveSlotVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpsertSaveSlotVariables {
  id: string;
  uid: string;
  slotNumber: number;
  lastLocationName?: string | null;
  playedTimeSeconds?: number | null;
  storageRef: string;
}
```
### Return Type
Recall that executing the `UpsertSaveSlot` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpsertSaveSlotData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpsertSaveSlotData {
  saveSlot_upsert: SaveSlot_Key;
}
```
### Using `UpsertSaveSlot`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, upsertSaveSlot, UpsertSaveSlotVariables } from '@aikami/frontend-dataconnect';

// The `UpsertSaveSlot` mutation requires an argument of type `UpsertSaveSlotVariables`:
const upsertSaveSlotVars: UpsertSaveSlotVariables = {
  id: ..., 
  uid: ..., 
  slotNumber: ..., 
  lastLocationName: ..., // optional
  playedTimeSeconds: ..., // optional
  storageRef: ..., 
};

// Call the `upsertSaveSlot()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await upsertSaveSlot(upsertSaveSlotVars);
// Variables can be defined inline as well.
const { data } = await upsertSaveSlot({ id: ..., uid: ..., slotNumber: ..., lastLocationName: ..., playedTimeSeconds: ..., storageRef: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await upsertSaveSlot(dataConnect, upsertSaveSlotVars);

console.log(data.saveSlot_upsert);

// Or, you can use the `Promise` API.
upsertSaveSlot(upsertSaveSlotVars).then((response) => {
  const data = response.data;
  console.log(data.saveSlot_upsert);
});
```

### Using `UpsertSaveSlot`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, upsertSaveSlotRef, UpsertSaveSlotVariables } from '@aikami/frontend-dataconnect';

// The `UpsertSaveSlot` mutation requires an argument of type `UpsertSaveSlotVariables`:
const upsertSaveSlotVars: UpsertSaveSlotVariables = {
  id: ..., 
  uid: ..., 
  slotNumber: ..., 
  lastLocationName: ..., // optional
  playedTimeSeconds: ..., // optional
  storageRef: ..., 
};

// Call the `upsertSaveSlotRef()` function to get a reference to the mutation.
const ref = upsertSaveSlotRef(upsertSaveSlotVars);
// Variables can be defined inline as well.
const ref = upsertSaveSlotRef({ id: ..., uid: ..., slotNumber: ..., lastLocationName: ..., playedTimeSeconds: ..., storageRef: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = upsertSaveSlotRef(dataConnect, upsertSaveSlotVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.saveSlot_upsert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.saveSlot_upsert);
});
```

## CreatePersona
You can execute the `CreatePersona` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
createPersona(vars: CreatePersonaVariables): MutationPromise<CreatePersonaData, CreatePersonaVariables>;

interface CreatePersonaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreatePersonaVariables): MutationRef<CreatePersonaData, CreatePersonaVariables>;
}
export const createPersonaRef: CreatePersonaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createPersona(dc: DataConnect, vars: CreatePersonaVariables): MutationPromise<CreatePersonaData, CreatePersonaVariables>;

interface CreatePersonaRef {
  ...
  (dc: DataConnect, vars: CreatePersonaVariables): MutationRef<CreatePersonaData, CreatePersonaVariables>;
}
export const createPersonaRef: CreatePersonaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createPersonaRef:
```typescript
const name = createPersonaRef.operationName;
console.log(name);
```

### Variables
The `CreatePersona` mutation requires an argument of type `CreatePersonaVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreatePersonaVariables {
  id: string;
  uid: string;
  name: string;
  avatarUrl?: string | null;
  voiceConfigId?: string | null;
  traits?: unknown | null;
  isActive: boolean;
}
```
### Return Type
Recall that executing the `CreatePersona` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreatePersonaData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreatePersonaData {
  persona_insert: Persona_Key;
}
```
### Using `CreatePersona`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createPersona, CreatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `CreatePersona` mutation requires an argument of type `CreatePersonaVariables`:
const createPersonaVars: CreatePersonaVariables = {
  id: ..., 
  uid: ..., 
  name: ..., 
  avatarUrl: ..., // optional
  voiceConfigId: ..., // optional
  traits: ..., // optional
  isActive: ..., 
};

// Call the `createPersona()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createPersona(createPersonaVars);
// Variables can be defined inline as well.
const { data } = await createPersona({ id: ..., uid: ..., name: ..., avatarUrl: ..., voiceConfigId: ..., traits: ..., isActive: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createPersona(dataConnect, createPersonaVars);

console.log(data.persona_insert);

// Or, you can use the `Promise` API.
createPersona(createPersonaVars).then((response) => {
  const data = response.data;
  console.log(data.persona_insert);
});
```

### Using `CreatePersona`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createPersonaRef, CreatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `CreatePersona` mutation requires an argument of type `CreatePersonaVariables`:
const createPersonaVars: CreatePersonaVariables = {
  id: ..., 
  uid: ..., 
  name: ..., 
  avatarUrl: ..., // optional
  voiceConfigId: ..., // optional
  traits: ..., // optional
  isActive: ..., 
};

// Call the `createPersonaRef()` function to get a reference to the mutation.
const ref = createPersonaRef(createPersonaVars);
// Variables can be defined inline as well.
const ref = createPersonaRef({ id: ..., uid: ..., name: ..., avatarUrl: ..., voiceConfigId: ..., traits: ..., isActive: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createPersonaRef(dataConnect, createPersonaVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.persona_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.persona_insert);
});
```

## UpdatePersona
You can execute the `UpdatePersona` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
updatePersona(vars: UpdatePersonaVariables): MutationPromise<UpdatePersonaData, UpdatePersonaVariables>;

interface UpdatePersonaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdatePersonaVariables): MutationRef<UpdatePersonaData, UpdatePersonaVariables>;
}
export const updatePersonaRef: UpdatePersonaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updatePersona(dc: DataConnect, vars: UpdatePersonaVariables): MutationPromise<UpdatePersonaData, UpdatePersonaVariables>;

interface UpdatePersonaRef {
  ...
  (dc: DataConnect, vars: UpdatePersonaVariables): MutationRef<UpdatePersonaData, UpdatePersonaVariables>;
}
export const updatePersonaRef: UpdatePersonaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updatePersonaRef:
```typescript
const name = updatePersonaRef.operationName;
console.log(name);
```

### Variables
The `UpdatePersona` mutation requires an argument of type `UpdatePersonaVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdatePersonaVariables {
  id: string;
  uid: string;
  name?: string | null;
  avatarUrl?: string | null;
  voiceConfigId?: string | null;
  traits?: unknown | null;
}
```
### Return Type
Recall that executing the `UpdatePersona` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdatePersonaData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdatePersonaData {
  persona_updateMany: number;
}
```
### Using `UpdatePersona`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updatePersona, UpdatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `UpdatePersona` mutation requires an argument of type `UpdatePersonaVariables`:
const updatePersonaVars: UpdatePersonaVariables = {
  id: ..., 
  uid: ..., 
  name: ..., // optional
  avatarUrl: ..., // optional
  voiceConfigId: ..., // optional
  traits: ..., // optional
};

// Call the `updatePersona()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updatePersona(updatePersonaVars);
// Variables can be defined inline as well.
const { data } = await updatePersona({ id: ..., uid: ..., name: ..., avatarUrl: ..., voiceConfigId: ..., traits: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updatePersona(dataConnect, updatePersonaVars);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
updatePersona(updatePersonaVars).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

### Using `UpdatePersona`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updatePersonaRef, UpdatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `UpdatePersona` mutation requires an argument of type `UpdatePersonaVariables`:
const updatePersonaVars: UpdatePersonaVariables = {
  id: ..., 
  uid: ..., 
  name: ..., // optional
  avatarUrl: ..., // optional
  voiceConfigId: ..., // optional
  traits: ..., // optional
};

// Call the `updatePersonaRef()` function to get a reference to the mutation.
const ref = updatePersonaRef(updatePersonaVars);
// Variables can be defined inline as well.
const ref = updatePersonaRef({ id: ..., uid: ..., name: ..., avatarUrl: ..., voiceConfigId: ..., traits: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updatePersonaRef(dataConnect, updatePersonaVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

## DeletePersona
You can execute the `DeletePersona` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
deletePersona(vars: DeletePersonaVariables): MutationPromise<DeletePersonaData, DeletePersonaVariables>;

interface DeletePersonaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeletePersonaVariables): MutationRef<DeletePersonaData, DeletePersonaVariables>;
}
export const deletePersonaRef: DeletePersonaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
deletePersona(dc: DataConnect, vars: DeletePersonaVariables): MutationPromise<DeletePersonaData, DeletePersonaVariables>;

interface DeletePersonaRef {
  ...
  (dc: DataConnect, vars: DeletePersonaVariables): MutationRef<DeletePersonaData, DeletePersonaVariables>;
}
export const deletePersonaRef: DeletePersonaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the deletePersonaRef:
```typescript
const name = deletePersonaRef.operationName;
console.log(name);
```

### Variables
The `DeletePersona` mutation requires an argument of type `DeletePersonaVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface DeletePersonaVariables {
  id: string;
  uid: string;
}
```
### Return Type
Recall that executing the `DeletePersona` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `DeletePersonaData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface DeletePersonaData {
  persona_deleteMany: number;
}
```
### Using `DeletePersona`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, deletePersona, DeletePersonaVariables } from '@aikami/frontend-dataconnect';

// The `DeletePersona` mutation requires an argument of type `DeletePersonaVariables`:
const deletePersonaVars: DeletePersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `deletePersona()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await deletePersona(deletePersonaVars);
// Variables can be defined inline as well.
const { data } = await deletePersona({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await deletePersona(dataConnect, deletePersonaVars);

console.log(data.persona_deleteMany);

// Or, you can use the `Promise` API.
deletePersona(deletePersonaVars).then((response) => {
  const data = response.data;
  console.log(data.persona_deleteMany);
});
```

### Using `DeletePersona`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, deletePersonaRef, DeletePersonaVariables } from '@aikami/frontend-dataconnect';

// The `DeletePersona` mutation requires an argument of type `DeletePersonaVariables`:
const deletePersonaVars: DeletePersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `deletePersonaRef()` function to get a reference to the mutation.
const ref = deletePersonaRef(deletePersonaVars);
// Variables can be defined inline as well.
const ref = deletePersonaRef({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = deletePersonaRef(dataConnect, deletePersonaVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.persona_deleteMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.persona_deleteMany);
});
```

## DeactivatePersonas
You can execute the `DeactivatePersonas` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
deactivatePersonas(vars: DeactivatePersonasVariables): MutationPromise<DeactivatePersonasData, DeactivatePersonasVariables>;

interface DeactivatePersonasRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeactivatePersonasVariables): MutationRef<DeactivatePersonasData, DeactivatePersonasVariables>;
}
export const deactivatePersonasRef: DeactivatePersonasRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
deactivatePersonas(dc: DataConnect, vars: DeactivatePersonasVariables): MutationPromise<DeactivatePersonasData, DeactivatePersonasVariables>;

interface DeactivatePersonasRef {
  ...
  (dc: DataConnect, vars: DeactivatePersonasVariables): MutationRef<DeactivatePersonasData, DeactivatePersonasVariables>;
}
export const deactivatePersonasRef: DeactivatePersonasRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the deactivatePersonasRef:
```typescript
const name = deactivatePersonasRef.operationName;
console.log(name);
```

### Variables
The `DeactivatePersonas` mutation requires an argument of type `DeactivatePersonasVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface DeactivatePersonasVariables {
  uid: string;
}
```
### Return Type
Recall that executing the `DeactivatePersonas` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `DeactivatePersonasData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface DeactivatePersonasData {
  persona_updateMany: number;
}
```
### Using `DeactivatePersonas`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, deactivatePersonas, DeactivatePersonasVariables } from '@aikami/frontend-dataconnect';

// The `DeactivatePersonas` mutation requires an argument of type `DeactivatePersonasVariables`:
const deactivatePersonasVars: DeactivatePersonasVariables = {
  uid: ..., 
};

// Call the `deactivatePersonas()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await deactivatePersonas(deactivatePersonasVars);
// Variables can be defined inline as well.
const { data } = await deactivatePersonas({ uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await deactivatePersonas(dataConnect, deactivatePersonasVars);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
deactivatePersonas(deactivatePersonasVars).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

### Using `DeactivatePersonas`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, deactivatePersonasRef, DeactivatePersonasVariables } from '@aikami/frontend-dataconnect';

// The `DeactivatePersonas` mutation requires an argument of type `DeactivatePersonasVariables`:
const deactivatePersonasVars: DeactivatePersonasVariables = {
  uid: ..., 
};

// Call the `deactivatePersonasRef()` function to get a reference to the mutation.
const ref = deactivatePersonasRef(deactivatePersonasVars);
// Variables can be defined inline as well.
const ref = deactivatePersonasRef({ uid: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = deactivatePersonasRef(dataConnect, deactivatePersonasVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

## ActivatePersona
You can execute the `ActivatePersona` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [generated/index.d.ts](./index.d.ts):
```typescript
activatePersona(vars: ActivatePersonaVariables): MutationPromise<ActivatePersonaData, ActivatePersonaVariables>;

interface ActivatePersonaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ActivatePersonaVariables): MutationRef<ActivatePersonaData, ActivatePersonaVariables>;
}
export const activatePersonaRef: ActivatePersonaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
activatePersona(dc: DataConnect, vars: ActivatePersonaVariables): MutationPromise<ActivatePersonaData, ActivatePersonaVariables>;

interface ActivatePersonaRef {
  ...
  (dc: DataConnect, vars: ActivatePersonaVariables): MutationRef<ActivatePersonaData, ActivatePersonaVariables>;
}
export const activatePersonaRef: ActivatePersonaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the activatePersonaRef:
```typescript
const name = activatePersonaRef.operationName;
console.log(name);
```

### Variables
The `ActivatePersona` mutation requires an argument of type `ActivatePersonaVariables`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ActivatePersonaVariables {
  id: string;
  uid: string;
}
```
### Return Type
Recall that executing the `ActivatePersona` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ActivatePersonaData`, which is defined in [generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ActivatePersonaData {
  persona_updateMany: number;
}
```
### Using `ActivatePersona`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, activatePersona, ActivatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `ActivatePersona` mutation requires an argument of type `ActivatePersonaVariables`:
const activatePersonaVars: ActivatePersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `activatePersona()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await activatePersona(activatePersonaVars);
// Variables can be defined inline as well.
const { data } = await activatePersona({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await activatePersona(dataConnect, activatePersonaVars);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
activatePersona(activatePersonaVars).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

### Using `ActivatePersona`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, activatePersonaRef, ActivatePersonaVariables } from '@aikami/frontend-dataconnect';

// The `ActivatePersona` mutation requires an argument of type `ActivatePersonaVariables`:
const activatePersonaVars: ActivatePersonaVariables = {
  id: ..., 
  uid: ..., 
};

// Call the `activatePersonaRef()` function to get a reference to the mutation.
const ref = activatePersonaRef(activatePersonaVars);
// Variables can be defined inline as well.
const ref = activatePersonaRef({ id: ..., uid: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = activatePersonaRef(dataConnect, activatePersonaVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.persona_updateMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.persona_updateMany);
});
```

