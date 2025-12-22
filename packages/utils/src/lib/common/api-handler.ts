type Actions = {
  [key in string]: [unknown, unknown]
}
type MessageType<T extends Actions> = keyof T

type Payload<
  T extends Actions,
  Type extends MessageType<T> = MessageType<T>,
> = T[Type][0]

type Response<
  T extends Actions,
  Type extends MessageType<T> = MessageType<T>,
> = T[Type][1]

/**
 * The `APIActions` type is a generic interface for an object of key-action
 * pairs. The keys represent the types of actions, and the values are the action
 * handler functions.
 *
 * Each handler function takes a payload corresponding to its action type, and
 * returns either a promise that resolves to a response, or directly a
 * response.
 *
 * This structure allows the `createApiHandler` function to dispatch actions to
 * their handlers based on the type specified in the APIRequest.
 *
 * @template T The `Actions` object type that defines the structure for each
 *   action's payload and response.
 */
export type APIActions<T extends Actions, Context = unknown> = {
  [key in MessageType<T>]: (
    payload: Payload<T, key>,
    context: Context,
  ) => Promise<Response<T, key>> | Response<T, key>
}

type APIRequest<T extends Actions> = {
  type: MessageType<T>
  payload: Payload<T>
}

/**
 * A generic handler for actions API calls.
 *
 * @param actions A set of actions.
 * @returns A function that takes an APIRequest object and processes it
 *   according to the actions provided.
 */
export const createApiHandler =
  <T extends Actions, Context = unknown>(actions: APIActions<T, Context>) =>
  async (request: APIRequest<T>, context: Context): Promise<Response<T>> => {
    if (!context) {
      throw new Error('Context is required')
    }
    const { payload, type } = request
    const action = actions[type]
    return await action(payload, context)
  }
