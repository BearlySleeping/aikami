/* eslint-disable @typescript-eslint/no-explicit-any */
/** Add a logger to the window object to be able to log from the mobile app */
export const addMobileLoggerUI = (): void => {
  (() => {
    if (typeof document === 'undefined' || document.querySelector('#mobile-log')) {
      return;
    }
    const output = document.createElement('pre');
    const divider = document.createElement('div');
    const clear = document.createElement('div');
    const content = document.createElement('div');
    document.body.appendChild(output);
    output.appendChild(clear);
    output.appendChild(content);
    output.id = 'mobile-log';
    output.style.position = 'fixed';
    output.style.top = '4px';
    output.style.left = '4px';
    output.style.right = '4px';
    output.style.borderRadius = '8px';
    output.style.padding = '12px';
    output.style.maxHeight = '200px';
    output.style.overflowX = 'scroll';
    output.style.background = '#222326';
    output.style.color = '#5FA9DC';
    output.style.fontFamily = 'monospace';
    output.style.zIndex = '99999999';
    output.style.overflowX = 'auto';
    output.style.opacity = '0.95';
    divider.style.height = '1px';
    divider.style.width = '100%';
    divider.style.background = '#C9AA82';
    divider.style.margin = '10px 0';
    clear.style.position = 'fixed';
    clear.style.top = '0';
    clear.style.right = '8px';
    clear.style.zIndex = '999999999';
    clear.style.padding = '7px 10px';
    clear.style.borderRadius = '50%';
    clear.style.background = '#F16464';
    output.style.color = '#E5F2FA';
    clear.innerText = 'X';
    clear.onclick = () => {
      content.innerHTML = '';
    };
    const log = (...items: unknown[]) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      items.forEach((item: unknown, i: number) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        items[i] = typeof item === 'object' ? JSON.stringify(item, null, 4) : item;
      });
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      content.innerHTML += `${items.join(' ')}<br />`;
      content.appendChild(divider);
      output.scrollTop = output.scrollHeight;
    };
    // (console as any).warn = log;
    // biome-ignore lint/suspicious/noConsole: intentional console wrapper
    const oldLog = console.log;
    // biome-ignore lint/suspicious/noExplicitAny: intentional console monkey-patching
    (console as any).mobileLog = log;
    // biome-ignore lint/suspicious/noExplicitAny: intentional console monkey-patching
    (console as any).error = function (...items: unknown[]) {
      log(items);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      oldLog.apply(this, items);
    };
  })();
};
