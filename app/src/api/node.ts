import { Request, Response } from 'express';
import { Logger } from '@utils/logger';
import config from '@utils/configuration';
import nodeManager, { isWalletAvailable } from '@utils/node';
import {
	walletLoadAddresses,
	walletBalance,
	walletUnlock,
	vpnChangeType,
} from '@utils/node';
import {
	containerStart,
	containerStop,
	containerRestart,
	containerRemove,
} from '@utils/docker';
import {
	isValidIP,
	isValidDns,
} from '@utils/validators';

/**
 * Get the node configuration
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeConfigurationGetValues(req: Request, res: Response): Promise<void>
{
	// Get node configuration
	const nodeConfig = nodeManager.getConfig();
	
	// Return the node configuration
	res.json({
		moniker: nodeConfig.moniker || null,
		backend: nodeConfig.backend || null,
		nodeType: nodeConfig.node_type || null,
		nodeIp: nodeConfig.node_ip || null,
		nodePort: nodeConfig.node_port || null,
		vpnType: nodeConfig.vpn_type || null,
		vpnPort: nodeConfig.vpn_port || null,
		vpnProtocol: nodeConfig.vpn_protocol || null,
		maximumPeers: nodeConfig.max_peers || null,
		dockerImage: config.DOCKER_IMAGE_NAME || null,
		casanodeVersion: config.CASANODE_VERSION || null,
	});
}

/**
 * Set node configuration values
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeConfigurationSetValues(req: Request, res: Response): Promise<void>
{
	try
	{
		// Indicate if vpnType was changed
		let vpnTypeChanged = false;
		const updates: {
			moniker?: string;
			backend?: string;
			nodeType?: string;
			nodeIp?: string;
			nodePort?: number;
			vpnType?: string;
			vpnPort?: number;
			vpnProtocol?: string;
			maximumPeers?: number;
		} = {};
		
		// Validate and queue 'moniker'
		if (req.body.moniker)
		{
			// Get the value from the request
			const moniker = req.body.moniker.trim();
			// Check if the value is at least 8 characters long
			if (moniker.length < 8)
			{
				res.status(400).json({
					error: true,
					message: 'Moniker must be at least 8 characters long.',
					success: false,
				});
				return ;
			}
			updates.moniker = moniker;
		}
		
		// Validate and queue 'backend'
		if (req.body.backend)
		{
			// Get the value from the request
			const backend = req.body.backend.trim().toLowerCase();
			// Check if the value is either 'test' or 'file'
			if (backend !== 'test' && backend !== 'file')
			{
				res.status(400).json({
					error: true,
					message: 'Backend must be either "test" or "file".',
					success: false,
				});
				return ;
			}
			updates.backend = backend;
		}
		
		// Validate and queue 'nodeType'
		if (req.body.nodeType)
		{
			// Get the value from the request
			const nodeType = req.body.nodeType.trim().toLowerCase();
			// Check if the value is either 'residential' or 'datacenter'
			if (nodeType !== 'residential' && nodeType !== 'datacenter')
			{
				res.status(400).json({
					error: true,
					message: 'NodeType must be either "residential" or "datacenter".',
					success: false,
				});
				return ;
			}
			updates.nodeType = nodeType;
		}
		
		// Validate and queue 'nodeIp'
		if (req.body.nodeIp)
		{
			// Get the value from the request
			const nodeIp = req.body.nodeIp.trim();
			// Check if the value is a valid IP or DNS
			if (!isValidIP(nodeIp) && !isValidDns(nodeIp))
			{
				res.status(400).json({
					error: true,
					message: 'Invalid node IP or DNS.',
					success: false,
				});
				return ;
			}
			updates.nodeIp = nodeIp;
		}
		
		// Validate and queue 'nodePort'
		if (req.body.nodePort)
		{
			// Get the value from the request
			const nodePort = parseInt(req.body.nodePort, 10);
			// Check if the value is a valid port number
			if (isNaN(nodePort) || nodePort < 1 || nodePort > 65535)
			{
				res.status(400).json({
					error: true,
					message: 'NodePort must be a valid integer between 1 and 65535.',
					success: false,
				});
				return ;
			}
			updates.nodePort = nodePort;
		}
		
		// Validate and queue 'vpnType'
		if (req.body.vpnType)
		{
			// Get the value from the request
			const vpnType = req.body.vpnType.trim().toLowerCase();
			// Check if the value is allowed
			if (!['wireguard', 'v2ray', 'openvpn'].includes(vpnType))
			{
				res.status(400).json({
					error: true,
					message: 'VpnType must be "wireguard", "v2ray" or "openvpn".',
					success: false,
				});
				return ;
			}
			updates.vpnType = vpnType;
			// Indicate that vpnType was changed
			vpnTypeChanged = true;
		}
		
		// Validate and queue 'vpnProtocol'
		if (req.body.vpnProtocol)
		{
			const vpnProtocol = req.body.vpnProtocol.trim().toLowerCase();
			if (vpnProtocol !== 'udp' && vpnProtocol !== 'tcp')
			{
				res.status(400).json({
					error: true,
					message: 'VpnProtocol must be either "udp" or "tcp".',
					success: false,
				});
				return ;
			}
			updates.vpnProtocol = vpnProtocol;
		}
		
		// Validate and queue 'vpnPort'
		if (req.body.vpnPort)
		{
			// Get the value from the request
			const vpnPort = parseInt(req.body.vpnPort, 10);
			// Check if the value is a valid port number
			if (isNaN(vpnPort) || vpnPort < 1 || vpnPort > 65535)
			{
				res.status(400).json({
					error: true,
					message: 'VpnPort must be a valid integer between 1 and 65535.',
					success: false,
				});
				return ;
			}
			updates.vpnPort = vpnPort;
		}
		
		// Validate and queue 'maximumPeers'
		if (req.body.maximumPeers)
		{
			// Get the value from the request
			const maximumPeers = parseInt(req.body.maximumPeers, 10);
			// Check if the value is a valid integer
			if (isNaN(maximumPeers) || maximumPeers < 1 || maximumPeers > 99999)
			{
				res.status(400).json({
					error: true,
					message: 'MaximumPeers must be a valid integer between 1 and 99999.',
					success: false,
				});
				return ;
			}
			updates.maximumPeers = maximumPeers;
		}
		
		const applyVpnUpdates = () =>
		{
			if (updates.vpnType)
				nodeManager.setVpnType(updates.vpnType);
			if (updates.vpnPort !== undefined)
				nodeManager.setVpnPort(updates.vpnPort);
			if (updates.vpnProtocol)
				nodeManager.setVpnProtocol(updates.vpnProtocol);
		};
		
		const applyStandardUpdates = () =>
		{
			if (updates.moniker)
				nodeManager.setMoniker(updates.moniker);
			if (updates.backend)
				nodeManager.setBackend(updates.backend);
			if (updates.nodeType)
				nodeManager.setNodeType(updates.nodeType);
			if (updates.nodeIp)
				nodeManager.setNodeIp(updates.nodeIp);
			if (updates.nodePort !== undefined)
				nodeManager.setNodePort(updates.nodePort);
			if (updates.maximumPeers !== undefined)
				nodeManager.setMaxPeers(updates.maximumPeers);
		};
		
		// Ensure VPN settings are available prior to vpnChangeType
		applyVpnUpdates();
		
		// If vpnType was changed, execute vpnChangeType
		if (vpnTypeChanged)
		{
			Logger.info('VpnType changed, executing vpnChangeType');
			await vpnChangeType();
			// Reload overwritten values with the requested ones
			applyVpnUpdates();
		}
		
		applyStandardUpdates();
		Logger.info(`Current node configuration: ${JSON.stringify(nodeManager.getConfig())}`);
		
		// Refresh the configuration files with the new values
		Logger.info('Starting node configuration update process');
		nodeManager.refreshConfigFiles();
		
		// Return the node configuration
		Logger.info('Node configuration updated successfully');
		res.json({
			success: true,
		});
	}
	catch (error: any)
	{
		// Handle any errors during the update process
		Logger.error(`Error updating node configuration: ${error.message}`);
		res.status(500).json({
			error: true,
			message: 'Error updating node configuration',
			success: false,
		});
	}
}

/**
 * Apply the node configuration in the file
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeConfigurationApply(req: Request, res: Response): Promise<void>
{
	try
	{
		// Refresh the configuration files with the new values
		Logger.info('Starting node configuration update process');
		nodeManager.refreshConfigFiles();
		
		// Return the node configuration
		Logger.info('Node configuration updated successfully');
		res.json({
			success: true,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error during node configuration update: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Node configuration update failed',
			success: false,
		});
	}
}

/**
 * Start the node
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeStart(req: Request, res: Response): Promise<void>
{
	try
	{
		// Start the node
		Logger.info('Starting node start process');
		const nodeStart = await containerStart();
		
		// Return the node start status
		Logger.info('Node start completed successfully');
		res.json({
			start: nodeStart,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error during node start: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Node start failed',
			start: false,
		});
	}
}

/**
 * Stop the node
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeStop(req: Request, res: Response): Promise<void>
{
	try
	{
		// Stop the node
		Logger.info('Starting node stop process');
		const nodeStop = await containerStop();
		
		// Return the node stop status
		Logger.info('Node stop completed successfully');
		res.json({
			stop: nodeStop,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error during node stop: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Node stop failed',
			stop: false,
		});
	}
}

/**
 * Restart the node
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeRestart(req: Request, res: Response): Promise<void>
{
	try
	{
		// Restart the node
		Logger.info('Starting node restart process');
		const nodeRestart = await containerRestart();
		
		// Return the node restart status
		Logger.info('Node restart completed successfully');
		res.json({
			restart: nodeRestart,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error during node restart: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Node restart failed',
			restart: false,
		});
	}
}

/**
 * Remove the node
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeRemove(req: Request, res: Response): Promise<void>
{
	try
	{
		// Remove the node
		Logger.info('Starting node removal process');
		const nodeRemove = await containerRemove();
		
		// Return the node removal status
		Logger.info('Node removal completed successfully');
		res.json({
			remove: nodeRemove,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error during node removal: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Node removal failed',
			remove: false,
		});
	}
}

/**
 * Get the node address (sentnode...)
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeAddress(req: Request, res: Response): Promise<void>
{
	try
	{
		Logger.info('Starting wallet address retrieval process');
		
		// Get node configuration
		const nodeConfig = nodeManager.getConfig();
		
		// Get the value from the configuration
		const address = nodeConfig.walletNodeAddress;
		// If address is empty
		if (address === '')
		{
			// If the passphrase is unavailable
			if (!nodeManager.passphraseAvailable())
				throw new Error('Passphrase unavailable');
			
			// Get the wallet passphrase stored in the configuration
			const passphrase = nodeConfig.walletPassphrase;
			
			// Load wallet information
			await walletLoadAddresses(passphrase);
		}
		
		// Return the value to the subscriber
		Logger.info('Wallet address retrieval completed successfully');
		res.json({
			address: nodeConfig.walletNodeAddress,
		});
	}
	catch (error: any)
	{
		// Return a structured error response
		Logger.error(`Error while loading the wallet address: ${error}`);
		res.status(500).json({
			error: true,
			message: 'Wallet address retrieval failed',
			address: '',
		});
	}
}

/**
 * Get the wallet node balance
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeBalance(req: Request, res: Response): Promise<void>
{
	try
	{
		Logger.info('Starting wallet balance retrieval process');
		
		// Get the wallet public address from the node configuration
		const publicAddress = nodeManager.getConfig().walletPublicAddress;
		
		// Check if the public address is empty
		if (publicAddress === '')
		{
			// No wallet configured yet — return 0 balance gracefully
			Logger.info('No public address configured; returning 0 DVPN balance');
			res.json({
				balance: '0 DVPN'
			});
			return;
		}
		
		// Retrieve the wallet balance
		const balance = await walletBalance(publicAddress);
		
		// Return the wallet balance as a JSON response
		Logger.info(`Wallet balance retrieved successfully: ${balance.amount} ${balance.denom}`);
		res.json({
			balance: `${balance.amount} ${balance.denom}`
		});
		
	}
	catch (error: any)
	{
		// Handle errors and send an appropriate response
		Logger.error(`Error while retrieving wallet balance: ${error.message || error}`);
		res.status(500).json({
			error: true,
			message: 'Wallet balance retrieval failed',
			balance: '0 DVPN' // Returning 0 DVPN in case of failure
		});
	}
}

/**
 * Set the wallet passphrase
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodePassphrase(req: Request, res: Response): Promise<void>
{
	try
	{
		
		// Get the passphrase value from the request body
		const { passphrase } = req.body;
		
		// Check if the passphrase is valid (not empty)
		if (!passphrase || passphrase.trim().length === 0)
		{
			Logger.error('Invalid passphrase received via API.');
			res.status(400).json({
				error: true,
				invalide: true,
				message: 'Invalid or empty passphrase.'
			});
			return ;
		}
		
		// Check if the wallet is available
		if (await isWalletAvailable())
		{
			// Try to unlock the wallet with the given passphrase
			const canUnlockWallet = await walletUnlock(passphrase);
			
			// If the passphrase is invalid
			if (!canUnlockWallet)
			{
				Logger.error('Invalid passphrase received via API for unlocking the wallet.');
				res.status(401).json({
					error: true,
					invalide: true,
					message: 'Invalid passphrase. Unable to unlock wallet.'
				});
				return ;
			}
		}
		
		// Set the passphrase in the configuration
		nodeManager.setPassphrase(passphrase);
		Logger.info('Passphrase updated successfully via API.');
		
		// Return a success response
		res.json({
			success: true,
			message: 'Passphrase updated successfully.'
		});
	}
	catch (error: any)
	{
		// Handle any errors and return a structured response
		Logger.error(`Error while setting passphrase: ${error.message || error}`);
		res.status(500).json({
			error: true,
			invalide: false,
			message: 'Failed to set passphrase due to a server error.'
		});
	}
}

/**
 * Check if the passphrase is available
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodePassphraseAvailable(req: Request, res: Response): Promise<void>
{
	// Return the passphrase availability
	res.json({
		required: nodeManager.passphraseRequired(true),
		available: nodeManager.passphraseAvailable(),
	});
}

/**
 * Get the node status
 * @param req Request
 * @param res Response
 * @returns Promise<void>
 */
export async function nodeStatus(req: Request, res: Response): Promise<void>
{
	// Return the status of the node
	res.json({
		status: await nodeManager.getStatus(),
	});
}
