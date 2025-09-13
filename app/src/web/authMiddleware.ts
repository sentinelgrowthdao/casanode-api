import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '@utils/configuration';
import { Logger } from '@utils/logger';

/**
 * Middleware for Bearer token authentication
 * @param req Request
 * @param res Response
 * @param next NextFunction
 * @returns void
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void
{
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.split(' ')[1];

	if (!token)
	{
		res.status(401).json({ error: 'Authorization token required' });
		return;
	}

	try
	{
		const decoded = jwt.verify(token, config.JWT_SECRET as string);
		// Attach decoded token if needed by handlers
		(req as any).jwt = decoded;
		next();
	}
	catch (_err)
	{
		Logger.error('Invalid or expired JWT token. ' + _err);
		res.status(403).json({ error: 'Invalid or expired token' });
	}
}
