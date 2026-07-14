import {
  executeMutation,
  executeQuery,
  mutationRef,
  queryRef,
  validateArgs,
  validateArgsWithOptions,
} from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'aikami-connector',
  service: 'firebase',
  location: 'us-east4',
};
export const listUsersRef = (dc) => {
  const { dc: dcInstance } = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListUsers');
};
listUsersRef.operationName = 'ListUsers';

export function listUsers(dcOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined, false, false);
  return executeQuery(
    listUsersRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
}

export const getTracksByMoodRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTracksByMood', inputVars);
};
getTracksByMoodRef.operationName = 'GetTracksByMood';

export function getTracksByMood(dcOrVars, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(
    getTracksByMoodRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
}

export const listSaveSlotsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListSaveSlots', inputVars);
};
listSaveSlotsRef.operationName = 'ListSaveSlots';

export function listSaveSlots(dcOrVars, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(
    listSaveSlotsRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
}

export const upsertSaveSlotRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpsertSaveSlot', inputVars);
};
upsertSaveSlotRef.operationName = 'UpsertSaveSlot';

export function upsertSaveSlot(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(upsertSaveSlotRef(dcInstance, inputVars));
}
