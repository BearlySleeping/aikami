const {
  queryRef,
  executeQuery,
  validateArgsWithOptions,
  mutationRef,
  executeMutation,
  validateArgs,
} = require('firebase/data-connect');

const connectorConfig = {
  connector: 'aikami-connector',
  service: 'firebase',
  location: 'us-east4',
};
exports.connectorConfig = connectorConfig;

const listUsersRef = (dc) => {
  const { dc: dcInstance } = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListUsers');
};
listUsersRef.operationName = 'ListUsers';
exports.listUsersRef = listUsersRef;

exports.listUsers = function listUsers(dcOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrOptions, options, undefined, false, false);
  return executeQuery(
    listUsersRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
};

const getTracksByMoodRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetTracksByMood', inputVars);
};
getTracksByMoodRef.operationName = 'GetTracksByMood';
exports.getTracksByMoodRef = getTracksByMoodRef;

exports.getTracksByMood = function getTracksByMood(dcOrVars, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(
    getTracksByMoodRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
};

const listSaveSlotsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListSaveSlots', inputVars);
};
listSaveSlotsRef.operationName = 'ListSaveSlots';
exports.listSaveSlotsRef = listSaveSlotsRef;

exports.listSaveSlots = function listSaveSlots(dcOrVars, varsOrOptions, options) {
  const {
    dc: dcInstance,
    vars: inputVars,
    options: inputOpts,
  } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(
    listSaveSlotsRef(dcInstance, inputVars),
    inputOpts && { fetchPolicy: inputOpts.fetchPolicy },
  );
};

const upsertSaveSlotRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpsertSaveSlot', inputVars);
};
upsertSaveSlotRef.operationName = 'UpsertSaveSlot';
exports.upsertSaveSlotRef = upsertSaveSlotRef;

exports.upsertSaveSlot = function upsertSaveSlot(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(upsertSaveSlotRef(dcInstance, inputVars));
};
