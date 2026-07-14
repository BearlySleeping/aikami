# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { listUsers, getTracksByMood, listSaveSlots, upsertSaveSlot } from '@aikami/frontend-dataconnect';


// Operation ListUsers: 
const { data } = await ListUsers(dataConnect);

// Operation GetTracksByMood:  For variables, look at type GetTracksByMoodVars in ../index.d.ts
const { data } = await GetTracksByMood(dataConnect, getTracksByMoodVars);

// Operation ListSaveSlots:  For variables, look at type ListSaveSlotsVars in ../index.d.ts
const { data } = await ListSaveSlots(dataConnect, listSaveSlotsVars);

// Operation UpsertSaveSlot:  For variables, look at type UpsertSaveSlotVars in ../index.d.ts
const { data } = await UpsertSaveSlot(dataConnect, upsertSaveSlotVars);


```