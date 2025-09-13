import express from 'express';
import http from 'http';
import cors from 'cors';
import { Logger } from '@utils/logger';
import config from '@utils/configuration';
import apiRouter from '@web/apiRoutes';

class WebServer
{
	private static instance: WebServer;
	private app = express();
	private apiHostname = '0.0.0.0';
	private apiPort = 8081;
	
	private constructor()
	{
		// If the API_LISTEN configuration is set
		if (config.API_LISTEN && config.API_LISTEN.includes(':'))
		{
			// Set the port and hostname from the configuration
			this.apiHostname = config.API_LISTEN.split(':')[0] || '0.0.0.0';
			this.apiPort = parseInt(config.API_LISTEN.split(':')[1]) || 8081;
		}
	}
	
	/**
	 * Get instance of WebServer
	 * @returns WebServer
	 */
	public static getInstance(): WebServer
	{
		if (!WebServer.instance)
		{
			WebServer.instance = new WebServer();
		}
		return WebServer.instance;
	}
	
	/**
     * Initialize the API server and routes
     */
	public async init(): Promise<void>
	{
		// Setup routes
		this.setupRoutes();
	}
	
	/**
	 * Setup routes for HTTP and HTTPS
	 * @returns void
	 */
	private setupRoutes()
	{
		// Enable CORS for all routes
		this.app.use(cors({
			origin: '*',
			methods: 'GET,HEAD,PUT,POST,DELETE',
			allowedHeaders: 'Content-Type, Authorization',
			credentials: false,
		}));
		
		// Add the JSON parsing middleware
		this.app.use(express.json());
		
		// Add the API routes
		this.app.use('/api/v1', apiRouter);
	}
	
	/**
	 * Start the API server (HTTP only)
	 * @returns void
	 */
	public start()
	{
		http.createServer(this.app)
			.listen(this.apiPort, this.apiHostname, () =>
			{
				Logger.info(`API server running at http://${this.apiHostname}:${this.apiPort}`);
			});
	}
}

export default WebServer;
