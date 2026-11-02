import { latestFx } from '@/lib/account';

export async function GET() {
  return Response.json({ fx: await latestFx() });
}
