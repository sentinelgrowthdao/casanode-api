import { Request, Response } from 'express';
import axios from 'axios';
import { Logger } from '@utils/logger';
import config from '@utils/configuration';
import { nodeConfig } from '@utils/node';
import { checkInstallation as checkNodeInstall, type InstallationCheck } from '@actions/index';
import { PortCheckStatus } from '@constants/portCheckStatus';

/**
 * GET /api/v1/check/installation
 * Returns the node installation status
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function checkInstallation(req: Request, res: Response): Promise<void>
{
	// Check the installation status
	const installationStatus : InstallationCheck = await checkNodeInstall();
	
	// Return the installation status
	res.json({
		image: installationStatus.image,
		containerExists: installationStatus.containerExists,
		nodeConfig: installationStatus.nodeConfig,
		certificateKey: installationStatus.certificateKey,
		wallet: installationStatus.wallet,
	});
}

/**
 * GET /api/v1/check/port/:port
 * Check the status of the requested port
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function checkPort(req: Request, res: Response): Promise<void>
{
	// Get the requested port
	const requestedPort = req.params.port;
	
	// Load the node configuration
	const configData = nodeConfig();

	// Determine which port to check
	let portToCheck: number = 0;
	
	// Determine which port to check
	if (requestedPort == 'node')
	{
		portToCheck = configData.node_port;
	}
	else if (requestedPort == 'vpn')
	{
		portToCheck = configData.vpn_port;
	}
	else
	{
		res.status(400).json({
			error: true,
			message: 'Invalid port type requested',
		});
		return;
	}
	
	// If port is not set, return an error
	if (portToCheck === 0)
	{
		res.status(400).json({
			error: true,
			message: 'Port not set in the configuration',
		});
		return;
	}
	
	// Url to check the port
	const checkUrl = `${config.FOXINODES_API_CHECK_PORT}${configData.node_ip}:${portToCheck}`;
	// Status of the port check
	let portCheckStatus = PortCheckStatus.NOT_STARTED;
	
	try
	{
		// Send the request to the API
		const response: any = await axios.get(checkUrl, { timeout: 60000 });
		Logger.info(`Port ${requestedPort} check response received`);
	
		// Check the response
		if (response.data?.error === false && response.data?.node?.success === true)
			portCheckStatus = PortCheckStatus.OPEN;
		else
			portCheckStatus = PortCheckStatus.CLOSED;
	}
	catch (error: any)
	{
		Logger.error(`Error while checking port: ${error}`);
		portCheckStatus = PortCheckStatus.ERROR;
	}
	
	// Return the installation status
	res.json({
		status: portCheckStatus,
	});
}
