import type * as Party from 'partykit/server';

const WEATHER_API_KEY = '36dd02d5282f473caec170818230810';

const createUrl = (location: string) =>
  `http://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${location}&aqi=no`;

export type Leaderboard = Record<
  string,
  {
    name: string;
    location: Location;
    current: Current;
  }
>;

interface Location {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  tz_id: string;
  localtime_epoch: number;
  localtime: string;
}

interface Condition {
  text: string;
  icon: string;
  code: number;
}

interface Current {
  last_updated_epoch: number;
  last_updated: string;
  temp_c: number;
  temp_f: number;
  is_day: number;
  condition: Condition;
  wind_mph: number;
  wind_kph: number;
  wind_degree: number;
  wind_dir: string;
  pressure_mb: number;
  pressure_in: number;
  precip_mm: number;
  precip_in: number;
  humidity: number;
  cloud: number;
  feelslike_c: number;
  feelslike_f: number;
  vis_km: number;
  vis_miles: number;
  uv: number;
  gust_mph: number;
  gust_kph: number;
}

interface WeatherResponse {
  location: Location;
  current: Current;
}

async function refetch(leaderboard: Leaderboard) {
  const promises = Object.values(leaderboard).map(({ location }) =>
    fetch(createUrl(location.name))
  );
  const responses = await Promise.all(promises);
  const jsons = await Promise.all(responses.map((r) => r.json()));
  const newLeaderboard = Object.fromEntries(
    Object.entries(leaderboard).map(([id, user], i) => [
      id,
      {
        ...user,
        current: jsons[i].current,
      },
    ])
  );

  return newLeaderboard;
}

export default class Server implements Party.Server {
  constructor(readonly party: Party.Party) {}

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // A websocket just connected!
    console.log(
      `Connected:
  id: ${conn.id}
  room: ${this.party.id}
  url: ${new URL(ctx.request.url).pathname}`
    );

    const leaderboard =
      (await this.party.storage.get<Record<string, Leaderboard>>(
        `leaderboard:${this.party.id}`
      )) ?? {};

    await this.party.storage.put(`leaderboard:${this.party.id}`, leaderboard);

    console.log('ROOM:', this.party.id);

    conn.send(
      JSON.stringify({
        type: 'leaderboard.updated',
        leaderboard: leaderboard,
      })
    );
  }

  async onStart(): Promise<void> {
    const leaderboard =
      (await this.party.storage.get<Leaderboard>(
        `leaderboard:${this.party.id}`
      )) ?? {};
    setInterval(async () => {
      const newLeaderboard = await refetch(leaderboard);

      await this.party.storage.put(
        `leaderboard:${this.party.id}`,
        newLeaderboard
      );

      this.party.broadcast(
        JSON.stringify({
          type: 'leaderboard.updated',
          leaderboard: newLeaderboard,
        })
      );
    }, 1000 * 60 * 10);
  }

  async onMessage(message: string, sender: Party.Connection) {
    const leaderboard =
      (await this.party.storage.get<Leaderboard>(
        `leaderboard:${this.party.id}`
      )) ?? {};
    const eventObject = JSON.parse(message);

    console.log(
      `connection ${sender.id} sent message with type: ${eventObject.type}`
    );

    if (eventObject.type === 'register') {
      this.party.broadcast(
        JSON.stringify({
          type: 'leaderboard.registered',
          name: eventObject.name,
          senderId: sender.id,
        })
      );
      fetch(createUrl(eventObject.location))
        .then((response) => response.json())
        .then(async (data: WeatherResponse) => {
          leaderboard[sender.id] = {
            name: eventObject.name,
            location: data.location,
            current: data.current,
          };

          await this.party.storage.put(
            `leaderboard:${this.party.id}`,
            leaderboard
          );

          this.party.broadcast(
            JSON.stringify({
              type: 'leaderboard.updated',
              leaderboard: leaderboard,
            })
          );
        })
        .catch((error) => {
          console.log(error);
        });
    }
  }

  async onRequest(req: Party.Request) {
    if (req.method === 'GET') {
      const stuff = await this.party.storage.list();

      const leaderboards: Record<string, Leaderboard> = {};
      for (const [key, value] of stuff) {
        if (key.startsWith('leaderboard:')) {
          leaderboards[key] = value as any;
        }
      }

      return new Response(JSON.stringify(leaderboards), {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  }
}

Server satisfies Party.Worker;
