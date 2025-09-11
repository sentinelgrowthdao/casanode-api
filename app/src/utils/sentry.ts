import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';
import config from '@utils/configuration';

// Sentry enabled flag
let sentryEnabled = false;
// Generate a unique session identifier
const sessionId = randomUUID();

/**
 * Initialize Sentry
 * @returns void
 */
export const initSentry = () =>
{
	// If the Sentry DSN is not defined
	if (!config.SENTRY_DSN)
	{
		console.log('Sentry is disabled. No DSN provided.');
		return;
	}
	
	// Set the Sentry enabled flag
	sentryEnabled = true;
	// Initialize Sentry
	Sentry.init({
		dsn: config.SENTRY_DSN || '',
		// Configure performance tracing
		tracesSampleRate: 1.0,
	});
	
	console.log('Sentry initialized with session ID:', sessionId);
};

/**
 * Capture an exception with Sentry
 * @param error - The error to capture
 * @returns void
 */
export const captureException = (error: any) =>
{
	if (!sentryEnabled)
		return;
	
	// Configure the scope for the message
	Sentry.withScope((scope) =>
	{
		// Identify the unique session
		scope.setTag('session_id', sessionId);
		// Add device identifier
		scope.setTag('device', (config.DEVICE_ID as string) || 'unknown_device');
		// Capture the exception
		Sentry.captureException(error);
	});
};

/**
 * Capture a message with a specific level
 * @param message - The message to capture
 * @param level - The level of the message
 * @returns void
 */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = 'info') =>
{
	if (!sentryEnabled)
		return;
	
	// Configure the scope for the message
	Sentry.withScope((scope) =>
	{
		// Identify the unique session
		scope.setTag('session_id', sessionId);
		// Add device identifier
		scope.setTag('device', (config.DEVICE_ID as string) || 'unknown_device');
		// Capture the message with the specified level
		if (level === 'error')
		{
			// Capture the message as an error
			Sentry.captureMessage(message, level);
		}
	});
};
