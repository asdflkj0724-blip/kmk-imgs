import { latestFxAll } from '@/lib/account';

export async function GET() {
  return Response.json({ fx: await latestFxAll() });
}
