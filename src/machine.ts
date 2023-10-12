import type { Leaderboard } from './server';
import {
  assign,
  createMachine,
  fromPromise,
  fromCallback,
  sendTo,
} from 'xstate';
import { partySocket } from './client';

export const weatherMachine = createMachine(
  {
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
      id: 'party',
      src: fromCallback(({ sendBack, receive }) => {
        partySocket.addEventListener('message', (event) => {
          const eventObject = JSON.parse(event.data);
          console.log(eventObject);
          sendBack(eventObject);
        });

        partySocket.addEventListener('open', () => {
          sendBack({ type: 'partySocket.open' });
        });

        receive((event) => {
          partySocket.send(JSON.stringify(event));
        });
      }),
    },
    states: {
      connecting: {
        on: {
          'partySocket.open': 'connected',
        },
      },
      connected: {
        initial: 'checkIfRegistered',

        states: {
          checkIfRegistered: {
            always: [
              {
                guard: 'hasRegistered',
                target: 'leaderboard',
              },
              { target: 'getName' },
            ],
          },
          getName: {
            tags: 'getName',
            on: {
              nameGiven: {
                target: 'getLocation',
                guard: ({ event }) => event.name.length,
                actions: assign({
                  name: ({ event }) => event.name,
                }),
              },
            },
          },
          getLocation: {
            invoke: {
              src: 'getLocation',
              onError: {
                target: 'noPermission',
              },
              onDone: [
                {
                  guard: ({ event }) => event.output,
                  actions: [
                    assign({
                      location: ({ event }) => event.output,
                    }),
                    sendTo('party', ({ context }) => ({
                      type: 'register',
                      name: context.name,
                      location: context.location,
                    })),
                  ],
                  target: 'leaderboard',
                },
                { target: 'noPermission' },
              ],
            },
          },
          noPermission: {
            tags: 'noPermission',
          },
          leaderboard: {
            entry: () => {
              localStorage.setItem('registered', 'true');
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
  },
  {
    guards: {
      hasRegistered: () => {
        return localStorage.getItem('registered') === 'true';
      },
    },
    actors: {
      getLocation: fromPromise(async () => {
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
    },
  }
);
