
import { Request, Response } from 'express';
import { Logger } from '@utils/logger';
import { createNodeConfig } from '@utils/node';
import { certificateGenerate } from '@utils/certificate';
import { imagePull } from '@utils/docker';

/**
 * Install the configuration
 * @param req Request
 * @param res Response
 */
export async function installConfiguration(req: Request, res: Response): Promise<void>
{
	// Status summary of node, VPN, and certificate generation
	let statusSummary =
	{
		nodeConfig: false,
		certificate: false
	};
	
	try
	{
		Logger.info('Starting configuration installation process');
		
		// Start creating the node configuration
		statusSummary.nodeConfig = await createNodeConfig();
		
		// Start generating the certificate
		statusSummary.certificate = await certificateGenerate();
		
		Logger.info('Configuration installation completed successfully');
		// Return the status summary in a well-structured JSON response
		res.json(statusSummary);
	}
	catch (error)
	{
		Logger.error(`Error during configuration installation: ${error}`);
		// Return a structured error response
		res.status(500).json({
			error: true,
			message: 'Configuration installation failed',
			...statusSummary,
		});
	}
}

/**
 * Install the docker image
 * @param req Request
 * @param res Response
 */
export async function dockerImage(req: Request, res: Response): Promise<void>
{
	try
	{
		Logger.info('Starting Docker image installation');

		// Start the image pull process
		const pullStatus = await imagePull();

		Logger.info('Docker image installation completed successfully');
		// Return the status summary in a well-structured JSON response
		res.json({
			imagePull: pullStatus,
		});
	}
	catch (error)
	{
		// Return a structured error response
		Logger.error(`Error while installing Docker image: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Docker image installation failed',
			imagePull: false,
		});
	}
}
