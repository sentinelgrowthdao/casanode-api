import { Logger } from '@utils/logger';
import WebServer from '@utils/web';
import { loadingNodeInformations, loadingSystemInformations } from '@actions/startup';

/**
 * Daemon command
 * @returns void
 */
export const daemonCommand = async () =>
{
	Logger.info('Daemon process started.');
	
	try
	{
		// Load system information
		try
		{
			await loadingSystemInformations();
		}
		catch (error: any)
		{
			Logger.error('System bootstrap failed, continuing with degraded startup.', error);
		}
		// Load node information in the background so startup stays resilient
		void startNodeBootstrap();

		// Start the web server even if node bootstrap fails
		await startWebServer();
	}
	catch (error: any)
	{
		Logger.error('An unexpected error occurred in daemon process.', error);
	}
};

/**
 * Bootstrap node information without blocking web server startup
 * @returns Promise<void>
 */
const startNodeBootstrap = async (): Promise<void> =>
{
	try
	{
		await loadingNodeInformations();
	}
	catch (error: any)
	{
		Logger.error('Node bootstrap failed, continuing with degraded startup.', error);
	}
};

/**
 * Start the web server
 * @returns void
 */
const startWebServer = async () =>
{
	try
	{
		Logger.info('Starting web server...');
		
		// Get the web server instance
		const webServer = WebServer.getInstance();
		// Initialize SSL and routes
		await webServer.init();
		// Start the web server
		webServer.start();
		
		Logger.info('Web server started successfully.');
	}
	catch (error: any)
	{
		Logger.error('Failed to start the web server.', error);
	}
};
