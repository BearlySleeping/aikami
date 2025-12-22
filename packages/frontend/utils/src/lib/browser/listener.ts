type EventTargetType = Window | Document | HTMLElement

/**
 * Creates an event listener for a specified event on a target object. Returns a
 * function that, when invoked, will remove this event listener.
 *
 * @param target - The target object for the event. This could be a DOM element,
 *   the document, or the window.
 * @param event - The name of the event to listen for.
 * @param handler - The function to be run when the event is triggered.
 * @returns - A function that, when invoked, will remove the event listener.
 */
export const createEventListener = (
  target: EventTargetType,
  event: string,
  handler: (event: Event) => void,
): () => void => {
  // Add the event listener
  target.addEventListener(event, handler)

  // Return a function that can be called to remove the listener
  return () => target.removeEventListener(event, handler)
}
