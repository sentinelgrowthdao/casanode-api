import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '@utils/configuration';
import { Logger } from '@utils/logger';

const ONE_YEAR = '365d';

/**
 * POST /api/v1/auth/login
 * Accepts a pre-shared token and returns a JWT (1 year)
 */
export async function login(req: Request, res: Response): Promise<void>
{
	try
	{
		const { token } = req.body || {};

		if (!token || typeof token !== 'string')
		{
			res.status(400).json({ error: 'Missing token' });
			return;
		}

		if (token !== config.API_AUTH)
		{
			res.status(403).json({ error: 'Invalid token' });
			return;
		}

		const payload = { sub: config.DEVICE_ID };
		const signed = jwt.sign(payload, config.JWT_SECRET as string, { expiresIn: ONE_YEAR });

		const decoded = jwt.decode(signed) as jwt.JwtPayload | null;
		const exp = decoded?.exp ? decoded.exp : undefined;

		res.json({
			jwt: signed,
			expiresAt: exp ? exp * 1000 : undefined,
		});
	}
	catch (err)
	{
		Logger.error('Login error: ' + err);
		res.status(500).json({ error: 'Login failed' });
	}
}

/**
 * POST /api/v1/auth/refresh
 * Requires a valid JWT; returns a fresh JWT (1 year)
 */
export async function refresh(req: Request, res: Response): Promise<void>
{
	try
	{
		// `authenticateToken` attaches the decoded JWT if needed
		const current = (req as any).jwt as jwt.JwtPayload | undefined;
		const sub = current?.sub || config.DEVICE_ID;

		const signed = jwt.sign({ sub }, config.JWT_SECRET as string, { expiresIn: ONE_YEAR });
		const decoded = jwt.decode(signed) as jwt.JwtPayload | null;
		const exp = decoded?.exp ? decoded.exp : undefined;

		res.json({
			jwt: signed,
			expiresAt: exp ? exp * 1000 : undefined,
		});
	}
	catch (err)
	{
		Logger.error('Token refresh error: ' + err);
		res.status(500).json({ error: 'Refresh failed' });
	}
}

