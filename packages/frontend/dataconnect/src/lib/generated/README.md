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
- [**Mutations**](#mutations)
  - [*UpsertSaveSlot*](#upsertsaveslot)

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
    email?: string | null;
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
    createdAt?: DateString | null;
    updatedAt?: DateString | null;
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

