import './styles.css';

import PartySocket from 'partysocket';
import { html, render } from 'lit-html';
import type { Leaderboard } from './server';

import {
  assign,
  createActor,
  createMachine,
  fromPromise,
  type AnyState,
  fromCallback,
} from 'xstate';

const view = (state: AnyState, leaderboard: Leaderboard) => {
  return html`
    <header>
      ${state.hasTag('noPermission')
        ? html`<h1>y u no permission</h1>`
        : html`<h1>Weatherboard</h1>`}
    </header>
    <div class="items">
      ${state.context.name && !leaderboard[state.context.id]
        ? html`
            <div
              class="item -loading"
              style="view-transition-name: ${state.context.id}"
            >
              <div class="user-weather">
                <div></div>
                <div>??&deg;</div>
              </div>
              <div class="user-name">${state.context.name}</div>
              <div class="user-location">Not sure yet...</div>
            </div>
          `
        : ''}
      ${Object.entries(leaderboard)
        .sort(
          ([, itemA], [, itemB]) => itemB.current.temp_c - itemA.current.temp_c
        )
        .map(
          ([id, { name, location, current }], i) => html`
            <div
              class="item"
              style="--i: ${i}; view-transition-name: ${id};"
              data-index="${i}"
            >
              <div class="user-weather">
                <img src="${current.condition.icon}" />
                <div>${current.temp_c}&deg;</div>
              </div>
              <div class="user-name">${name}</div>
              <div class="user-location">
                ${location.name}, ${location.country}
              </div>
            </div>
          `
        )}
    </div>
  `;
};

declare const PARTYKIT_HOST: string;

const elApp = document.getElementById('app') as HTMLDivElement;

const partySocket = new PartySocket({
  host: PARTYKIT_HOST,
  room: 'my-new-room',
});

const machine = createMachine({
  initial: 'connecting',
  types: {
    context: {} as {
      name: string | null;
      location: string | null;
      leaderboard: Leaderboard;
      id: string;
    },
    input: {} as {
      id: string;
    },
  },
  context: ({ input }) => {
    return {
      name: null,
      location: null,
      leaderboard: {},
      id: input.id,
    };
  },
  invoke: {
    src: fromCallback(({ sendBack }) => {
      partySocket.addEventListener('message', (event) => {
        const eventObject = JSON.parse(event.data);
        sendBack(eventObject);
      });
    }),
  },
  states: {
    connecting: {
      invoke: {
        src: fromPromise(() => {
          return new Promise((res) => {
            partySocket.addEventListener('open', () => {
              res(partySocket.id);
            });
          });
        }),
        onDone: {
          target: 'connected',
          actions: assign({}),
        },
      },
    },
    connected: {
      initial: 'getName',
      states: {
        getName: {
          tags: 'getName',
          invoke: {
            src: fromPromise(async () => {
              const name = prompt('What is your name?');
              return Promise.resolve(name);
            }),
            onDone: {
              actions: assign({
                name: ({ event }) => event.output,
              }),
              // target: 'getLocation',
            },
          },
          always: {
            guard: ({ context }) => !!context.name,
            target: 'getLocation',
          },
        },
        getLocation: {
          invoke: {
            src: fromPromise(async () => {
              if (!navigator.geolocation) {
                return Promise.reject('no permission');
              }

              // get location from browser
              const location = await new Promise((res, rej) =>
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    res(`${pos.coords.latitude},${pos.coords.longitude}`);
                  },
                  (err) => {
                    rej(err);
                  }
                )
              );

              const res = Promise.resolve(location);

              return res;
            }),
            onError: {
              target: 'noPermission',
              actions: () => {
                console.log('huh?');
              },
            },
            onDone: [
              {
                guard: ({ event }) => event.output,
                actions: [
                  assign({
                    location: ({ event }) => event.output,
                  }),
                  ({ context }) => {
                    partySocket.send(
                      JSON.stringify({
                        type: 'register',
                        name: context.name,
                        location: context.location,
                      })
                    );
                  },
                ],
                target: 'leaderboard',
              },
              { target: 'noPermission' },
            ],
          },
          always: {
            guard: ({ context }) => context.location !== null,
            target: 'leaderboard',
          },
        },
        noPermission: {
          tags: 'noPermission',
        },
        leaderboard: {
          entry: () => {
            partySocket.send(JSON.stringify({ type: 'sup' }));
          },
        },
      },
    },
  },
  on: {
    'leaderboard.updated': {
      actions: assign({
        leaderboard: ({ event }) => event.leaderboard,
      }),
    },
  },
});

const actor = createActor(machine, {
  input: {
    id: partySocket.id,
  },
  inspect: (ev) => {
    if (ev.type === '@xstate.event' && ev.targetRef === actor) {
      console.log(ev);
    }
  },
});

actor.subscribe((s) => {
  if ('startViewTransition' in document) {
    (document as any).startViewTransition(() => {
      render(view(actor.getSnapshot(), s.context.leaderboard), elApp);
    });
  } else {
    render(view(actor.getSnapshot(), s.context.leaderboard), elApp);
  }
});

actor.start();
