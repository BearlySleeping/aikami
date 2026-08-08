# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { listUsers, getTracksByMood, listSaveSlots, upsertSaveSlot, listPersonas, getPersona, createPersona, updatePersona, deletePersona, deactivatePersonas } from '@aikami/frontend-dataconnect';


// Operation ListUsers: 
const { data } = await ListUsers(dataConnect);

// Operation GetTracksByMood:  For variables, look at type GetTracksByMoodVars in ../index.d.ts
const { data } = await GetTracksByMood(dataConnect, getTracksByMoodVars);

// Operation ListSaveSlots:  For variables, look at type ListSaveSlotsVars in ../index.d.ts
const { data } = await ListSaveSlots(dataConnect, listSaveSlotsVars);

// Operation UpsertSaveSlot:  For variables, look at type UpsertSaveSlotVars in ../index.d.ts
const { data } = await UpsertSaveSlot(dataConnect, upsertSaveSlotVars);

// Operation ListPersonas:  For variables, look at type ListPersonasVars in ../index.d.ts
const { data } = await ListPersonas(dataConnect, listPersonasVars);

// Operation GetPersona:  For variables, look at type GetPersonaVars in ../index.d.ts
const { data } = await GetPersona(dataConnect, getPersonaVars);

// Operation CreatePersona:  For variables, look at type CreatePersonaVars in ../index.d.ts
const { data } = await CreatePersona(dataConnect, createPersonaVars);

// Operation UpdatePersona:  For variables, look at type UpdatePersonaVars in ../index.d.ts
const { data } = await UpdatePersona(dataConnect, updatePersonaVars);

// Operation DeletePersona:  For variables, look at type DeletePersonaVars in ../index.d.ts
const { data } = await DeletePersona(dataConnect, deletePersonaVars);

// Operation DeactivatePersonas:  For variables, look at type DeactivatePersonasVars in ../index.d.ts
const { data } = await DeactivatePersonas(dataConnect, deactivatePersonasVars);


```