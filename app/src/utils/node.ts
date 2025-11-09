import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import https from 'https';
import { Logger } from '@utils/logger';
import {
	isPassphraseError, containerCommand,
	containerExists, containerRunning, containerStart, containerStop, containerRemove
} from '@utils/docker';
import { getRemoteAddress } from '@utils/configuration';
import { checkInstallation } from '@actions/checkInstallation';
import config from './configuration';

// Defaults values for node configuration
const DATACENTER_GIGABYTE_PRICES = 'udvpn:0.0025,12_500_000';
const DATACENTER_HOURLY_PRICES = 'udvpn:0.005,25_000_000';
const RESIDENTIAL_GIGABYTE_PRICES = 'udvpn:0.0025,12_500_000';
const RESIDENTIAL_HOURLY_PRICES = 'udvpn:0.005,25_000_000';
const DEFAULT_CHAIN_ID = 'sentinelhub-2';
const DEFAULT_RPC_ADDRESSES = [
	'https://rpc.sentineldao.com:443',
	'https://rpc-sentinel.busurnode.com:443',
	'https://sentinel-rpc.publicnode.com:443'
];

// Balance
export interface BalanceWallet
{
	denom: string;
	amount: number;
}
// Response from the API
export interface BalancesResponse
{
	balances: {
		denom: string;
		amount: string;
	}[];
	pagination: {
		next_key: string | null;
		total: string;
	};
}

export interface NodeConfigData
{
	[key: string]: string | string[] | number | boolean | undefined;
	moniker: string;
	chain_id: string;
	rpc_addresses: string;
	node_ip: string;
	vpn_type: string;
	node_port: number;
	vpn_port: number;
	backend: string;
	handshake: boolean;
	wallet_name: string;
	max_peers: number;
	gas: string;
	gas_adjustment: string;
	gas_prices: string;
	node_type: string;
	gigabyte_prices: string;
	hourly_prices: string;
	walletPublicAddress: string;
	walletNodeAddress: string;
	walletPassphrase: string;
	walletMnemonic: string[];
	nodeLocation: string;
	systemUptime: number;
	systemOs: string;
	systemKernel: string;
	systemArch: string;
	casanodeVersion: string;
}

export interface NodeStatus
{
	type: number;
	version: string;
	bandwidth:
	{
		download: number;
		upload: number;
	},
	handshake:
	{
		enable: boolean;
		peers: number;
	},
	location:
	{
		city: string;
		country: string;
		latitude: number;
		longitude: number;
	},
	peers: number;
	max_peers: number;
}

class NodeManager
{
	private static instance: NodeManager;
	private defaultNodeConfig: NodeConfigData = {
		moniker: '',
		node_type: '',
		chain_id: '',
		rpc_addresses: '',
		node_ip: '',
		vpn_type: '',
		node_port: 0,
		vpn_port: 0,
		backend: '',
		handshake: false,
		wallet_name: '',
		max_peers: 0,
		gas: '',
		gas_adjustment: '',
		gas_prices: '',
		gigabyte_prices: '',
		hourly_prices: '',
		// Contains the public address of the wallet
		walletPublicAddress: '',
		// Contains the node address of the wallet
		walletNodeAddress: '',
		// Contains the passphrase of the wallet
		walletPassphrase: '',
		// Contains the mnemonic of the wallet
		walletMnemonic: [],
		// Contains the country code of the node
		nodeLocation: '',
		// Contains the uptime of the node
		systemUptime: 0,
		// Contains the OS of the node
		systemOs: '',
		// Contains the kernel of the node
		systemKernel: '',
		// Contains the architecture of the node
		systemArch: '',
		// Contains the version of the node
		casanodeVersion: '1.0.0',
	};

	private nodeConfig: NodeConfigData = { ...this.defaultNodeConfig };
	
	private constructor()
	{
		this.loadNodeConfig();
	}
	
	/**
	 * Get instance of NodeManager
	 * @returns NodeManager
	 */
	public static getInstance(): NodeManager
	{
		if (!NodeManager.instance)
		{
			NodeManager.instance = new NodeManager();
		}
		return NodeManager.instance;
	}
	
	/**
	 * Get current configuration
	 * @returns NodeConfigData
	 */
	public getConfig(): NodeConfigData
	{
		return this.nodeConfig;
	}
	
	/**
	 * Reset the node configuration
	 * @returns void
	 */
	public resetNodeConfig(): void
	{
		this.nodeConfig = { ...this.defaultNodeConfig };
	}
	
	/**
	 * Check if the configuration file exists
	 * @param configFilePath - Path to the configuration file
	 * @returns boolean
	 */
	public isConfigFileAvailable(configFilePath: string): boolean
	{
		try
		{
			return fs.existsSync(configFilePath);
		}
		catch (error)
		{
			Logger.error(`Error checking config file ${configFilePath}: ${error}`);
			return false;
		}
	}
	
	/**
	 * Check if the wallet is available
	 */
	public async isWalletAvailable(): Promise<boolean>
	{
		try
		{
			const exists = await this.walletExists(this.nodeConfig.walletPassphrase);
			return exists ?? false;
		}
		catch (error)
		{
			Logger.error(`Error checking wallet existence: ${error}`);
			return false;
		}
	}
	
	/**
	 * Load configuration files and extract node parameters
	 */
	public loadNodeConfig(): void
	{
		// Initialize node configuration file path
		const configFilePath = path.join(config.CONFIG_DIR, 'config.toml');
		// If the configuration files do not exist, do nothing
		if (!this.isConfigFileAvailable(configFilePath))
		{
			Logger.info('Configuration files do not exist.');
			return ;
		}
		
		try
		{
			// Load configuration file content
			const configFileContent = fs.readFileSync(configFilePath, 'utf8');
			
			// Parse configuration file content
			this.nodeConfig.moniker = this.extractConfigValue(configFileContent, 'moniker');
			this.nodeConfig.chain_id = this.extractConfigValue(configFileContent, 'id');
			this.nodeConfig.rpc_addresses = this.extractConfigValue(configFileContent, 'rpc_addresses');
			this.nodeConfig.vpn_type = this.extractConfigValue(configFileContent, 'type');
			this.nodeConfig.max_peers = parseInt(this.extractConfigValue(configFileContent, 'max_peers'));
			this.nodeConfig.backend = this.extractConfigValue(configFileContent, 'backend');
			this.nodeConfig.wallet_name = this.extractConfigValue(configFileContent, 'from');
			this.nodeConfig.handshake = this.extractConfigValueInSection(configFileContent, 'handshake', 'enable') === 'true';
			this.nodeConfig.gas = this.extractConfigValue(configFileContent, 'gas');
			this.nodeConfig.gas_adjustment = this.extractConfigValue(configFileContent, 'gas_adjustment');
			this.nodeConfig.gas_prices = this.extractConfigValue(configFileContent, 'gas_prices');
			this.nodeConfig.gigabyte_prices = this.extractConfigValue(configFileContent, 'gigabyte_prices');
			this.nodeConfig.hourly_prices = this.extractConfigValue(configFileContent, 'hourly_prices');
			
			// Extract the node IP and port
			const remote_url = this.extractConfigValue(configFileContent, 'remote_url');
			const listen_on = this.extractConfigValue(configFileContent, 'listen_on');
			
			// Extract the node IP and port
			if (remote_url && remote_url !== '' && remote_url.includes(':'))
				this.nodeConfig.node_ip = remote_url.split('/')[2].split(':')[0];
			
			// Extract the node port
			if (listen_on && listen_on !== '' && listen_on.includes(':'))
				this.nodeConfig.node_port = parseInt(listen_on.split(':')[1]);
			
			// Set the node type based on the prices
			this.nodeConfig.node_type = this.nodeConfig.hourly_prices === DATACENTER_HOURLY_PRICES ? 'datacenter' : this.nodeConfig.hourly_prices ? 'residential' : '';
			
			// Load WireGuard configuration file content
			if (this.nodeConfig.vpn_type === 'wireguard')
			{
				Logger.info('Loading WireGuard configuration file content');
				const wireguardConfigPath = path.join(config.CONFIG_DIR, 'wireguard.toml');
				const wireguardConfigContent = fs.readFileSync(wireguardConfigPath, 'utf8');
				this.nodeConfig.vpn_port = parseInt(this.extractConfigValue(wireguardConfigContent, 'listen_port'));
			}
			// Load V2Ray configuration file content
			else if (this.nodeConfig.vpn_type === 'v2ray')
			{
				Logger.info('Loading V2Ray configuration file content');
				const v2rayConfigPath = path.join(config.CONFIG_DIR, 'v2ray.toml');
				const v2rayConfigContent = fs.readFileSync(v2rayConfigPath, 'utf8');
				this.nodeConfig.vpn_port = parseInt(this.extractConfigValue(v2rayConfigContent, 'listen_port'));
			}
			
		}
		catch (error)
		{
			Logger.error(`Error loading node configuration: ${error}`);
		}
	}
	
	/**
	 * Refresh node location
	 * @returns void
	 */
	public async refreshNodeLocation(): Promise<void>
	{
		const remoteAddress = await getRemoteAddress();
		// Set the node location
		this.nodeConfig.nodeLocation = remoteAddress.country ?? 'N/A';
		// Set the node IP address only if it is not already set
		if (this.nodeConfig.node_ip === '')
			this.nodeConfig.node_ip = remoteAddress.ip ?? '';
	}
	
	/**
	 * Extract configuration value from the content
	 * @param content - File content
	 * @param key - Configuration key
	 * @returns string
	 */
	private extractConfigValue(content: string, key: string): string
	{
		const regex = new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm');
		const match = content.match(regex);
		// Return the value if found, otherwise an empty string
		return match ? match[1].trim() : '';
	}
	
	/**
	 * Extract configuration value from a specific section
	 * @param content - File content
	 * @param section - Section name
	 * @param key - Configuration key
	 * @returns string
	 */
	private extractConfigValueInSection(content: string, section: string, key: string): string
	{
		// Create a regex to match the section
		const sectionRegex = new RegExp(`\\[${section}\\]([\\s\\S]*?)\\[`, 'm');
		const sectionMatch = content.match(sectionRegex);
		// If the section is found, extract the key value
		if (sectionMatch)
		{
			// Create a regex to match the key
			const keyRegex = new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm');
			const keyMatch = sectionMatch[1].match(keyRegex);
			return keyMatch ? keyMatch[1].trim() : '';
		}
		return '';
	}

	/**
	 * Refresh node configuration files
	 */
	public refreshConfigFiles(): void
	{
		const configFilePath = path.join(config.CONFIG_DIR, 'config.toml');
		
		try
		{
			this.updateConfigValue(configFilePath, 'moniker', this.nodeConfig.moniker);
			this.updateConfigValue(configFilePath, 'id', this.nodeConfig.chain_id);
			this.updateConfigValue(configFilePath, 'rpc_addresses', this.nodeConfig.rpc_addresses);
			this.updateConfigValue(configFilePath, 'listen_on', `0.0.0.0:${this.nodeConfig.node_port}`);
			this.updateConfigValue(configFilePath, 'remote_url', `https://${this.nodeConfig.node_ip}:${this.nodeConfig.node_port}`);
			this.updateConfigValue(configFilePath, 'backend', this.nodeConfig.backend);
			this.updateConfigValue(configFilePath, 'max_peers', this.nodeConfig.max_peers);
			this.updateConfigValue(configFilePath, 'gas', this.nodeConfig.gas);
			this.updateConfigValue(configFilePath, 'gas_adjustment', this.nodeConfig.gas_adjustment);
			this.updateConfigValue(configFilePath, 'gas_prices', this.nodeConfig.gas_prices);
			this.updateConfigValue(configFilePath, 'gigabyte_prices', this.nodeConfig.gigabyte_prices);
			this.updateConfigValue(configFilePath, 'hourly_prices', this.nodeConfig.hourly_prices);
			
			// Apply VPN configuration changes
			this.vpnChangeType();
			
			Logger.info('Configuration files have been refreshed.');
		}
		catch (error)
		{
			Logger.error(`Error refreshing configuration files: ${error}`);
		}
	}
	
	/**
	 * Apply VPN configuration changes
	 * @returns Promise<boolean>
	 */
	public async vpnChangeType(): Promise<boolean>
	{
		// Configuration file paths
		const configFilePath = path.join(config.CONFIG_DIR, 'config.toml');
		const wireguardConfigPath = path.join(config.CONFIG_DIR, 'wireguard.toml');
		const v2rayConfigPath = path.join(config.CONFIG_DIR, 'v2ray.toml');
		
		// Get the current VPN type
		const current_vpn_type = this.extractConfigValue(fs.readFileSync(configFilePath, 'utf8'), 'type');
		// Get the VPN port
		const current_vpn_port = this.nodeConfig.vpn_port;
		
		// If the VPN type is not changed, do nothing
		if (current_vpn_type === this.nodeConfig.vpn_type)
		{
			Logger.info('VPN type has not been changed.');
			
			// If the configuration file exists, update the VPN port
			if (this.nodeConfig.vpn_type === 'wireguard')
			{
				// Update the listen port
				this.updateConfigValue(wireguardConfigPath, 'listen_port', current_vpn_port);
			}
			else
			{
				// Update the listen port
				this.updateConfigValue(v2rayConfigPath, 'listen_port', current_vpn_port);
			}
			return true;
		}
		
		// Change the VPN type in the node configuration file
		this.updateConfigValue(configFilePath, 'type', this.nodeConfig.vpn_type);
		// Change the handshake enable in the node configuration file
		this.updateConfigValueInSection(configFilePath, 'handshake', 'enable', this.nodeConfig.vpn_type === 'wireguard' ? 'true' : 'false');
		
		// Update VPN configuration files
		if (this.nodeConfig.vpn_type === 'wireguard')
		{
			// If file does not exist, create it
			if (!this.isConfigFileAvailable(wireguardConfigPath))
			{
				// If the other configuration file exists
				if (this.isConfigFileAvailable(v2rayConfigPath))
				{
					// Remove the other configuration file
					Logger.info(`Deleting V2Ray configuration file: ${v2rayConfigPath}`);
					await fs.rm(v2rayConfigPath, (error) =>
					{
						if (error)
							Logger.error(`Failed to delete V2Ray configuration file: ${error}`);
					});
				}
				
				// Generate the configuration file
				await createVpnConfig();
			}
			
			// Update the listen port
			this.updateConfigValue(wireguardConfigPath, 'listen_port', current_vpn_port);
		}
		else if (this.nodeConfig.vpn_type === 'v2ray')
		{
			// If file does not exist, create it
			if (!this.isConfigFileAvailable(v2rayConfigPath))
			{
				// If the other configuration file exists
				if (this.isConfigFileAvailable(wireguardConfigPath))
				{
					// Remove the other configuration file
					Logger.info(`Deleting WireGuard configuration file: ${wireguardConfigPath}`);
					await fs.rm(wireguardConfigPath, (error) =>
					{
						if (error)
							Logger.error(`Failed to delete WireGuard configuration file: ${error}`);
					});
				}
				
				// Generate the configuration file
				await createVpnConfig();
			}
			// Update the listen port
			this.updateConfigValue(v2rayConfigPath, 'listen_port', current_vpn_port);
		}
		
		// Reload node configuration
		await this.loadNodeConfig();
		
		// Check if the container exists and running
		const exists = await containerExists();
		const running = await containerRunning();
		
		// If the container exists
		if (exists)
		{
			// Stop the container if running
			if (running)
			{
				Logger.info('Stopping the container to apply VPN configuration changes.');
				await containerStop();
			}
			
			// Remove the container
			Logger.info('Removing the container to apply VPN configuration changes.');
			await containerRemove();
			
			// Start the container if it was running
			if (running)
			{
				Logger.info('Starting the container after applying VPN configuration changes.');
				await containerStart();
			}
		}
		
		return true;
	}
	
	/**
	 * Update a configuration value in a file
	 * @param filePath - Path to the configuration file
	 * @param key - Configuration key
	 * @param value - New value
	 */
	private updateConfigValue(filePath: string, key: string, value: string | number): void
	{
		const regex = new RegExp(`^(${key}\\s*=\\s*).*`, 'm');
		const content = fs.readFileSync(filePath, 'utf8');
		const newValue = `${key} = "${value}"`;
		const newContent = content.replace(regex, newValue);
		fs.writeFileSync(filePath, newContent, 'utf8');
	}
	
	/**
	 * Update a configuration value in a specific section of a file
	 * @param filePath - Path to the configuration file
	 * @param section - Section name
	 * @param key - Configuration key
	 * @param value - New value
	 */
	private updateConfigValueInSection(filePath: string, section: string, key: string, value: string): void
	{
		const sectionRegex = new RegExp(`(\\[${section}\\][\\s\\S]*?)(^${key}\\s*=\\s*).*`, 'm');
		const content = fs.readFileSync(filePath, 'utf8');
		const newValue = `${key} = "${value}"`;
		const newContent = content.replace(sectionRegex, `$1${newValue}`);
		fs.writeFileSync(filePath, newContent, 'utf8');
	}
	
	/**
	 * Create node configuration file
	 * @returns boolean
	 */
	public async createNodeConfig(): Promise<boolean>
	{
		// Check if the configuration file already exists
		if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'config.toml')))
			return true;
		
		// Create configuration file
		const output: string|null = await containerCommand(['process', 'config', 'init']);
		
		// Return if the configuration file has been created
		if (output !== null && output === '')
		{
			// Load the node configuration
			await this.loadNodeConfig();
			// Return success
			return true;
		}
		else
		{
			Logger.error(`Failed to create node configuration file: ${output?.trim()}`);
			return false;
		}
	}
	
	/**
	 * Create VPN configuration file
	 * @returns boolean
	 */
	public async createVpnConfig(): Promise<boolean>
	{
		let output: string|null = '';
		
		// Create WireGuard configuration file
		if (this.nodeConfig.vpn_type === 'wireguard')
		{
			// Check if the configuration file already exists
			if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'wireguard.toml')))
				return true;
			
			// Create configuration file
			output = await containerCommand(['process', 'wireguard', 'config', 'init']);
		}
		// Create V2Ray configuration file
		else if (this.nodeConfig.vpn_type === 'v2ray')
		{
			// Check if the configuration file already exists
			if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'v2ray.toml')))
				return true;
			
			// Create configuration file
			output = await containerCommand(['process', 'v2ray', 'config', 'init']);
		}
		
		// Return if the configuration file has been created
		if (output !== null && output === '')
		{
			// Load the node configuration
			await this.loadNodeConfig();
			// Return success
			return true;
		}
		else
		{
			Logger.error(`Failed to create VPN configuration file: ${output?.trim()}`);
			return false;
		}
	}
	
	/**
	 * Build the stdin for the command
	 * @param passphrase string|null
	 * @param passphraseRepeat number
	 * @param stdin string[]|null
	 * @returns string[]|null
	 */
	private buildStdinCommand(passphrase: string|null = null, passphraseRepeat: number = 1, stdin: string[]|null = null): string[]|null
	{
		// If passphrase required, add it to the stdin
		if (passphrase !== null)
		{
			if (stdin === null)
				stdin = [];
			for (let i = 0; i < passphraseRepeat; i++)
				stdin.push(passphrase);
		}
		// Return the stdin
		return stdin;
	}
	
	/**
	 * Check if the passphrase is valid
	 * @param passphrase string|null
	 * @returns boolean
	 */
	public isPassphraseValid(passphrase: string | null): boolean
	{
		// Return false if the passphrase is required but not provided
		if (this.passphraseRequired() && (passphrase === null || passphrase?.trim().length === 0))
			return false;
		// Return true if the passphrase is valid
		return true;
	}
	
	/**
	 * Check if passphrase can unlock the wallet
	 * @param passphrase string|null
	 * @returns boolean
	 */
	public async walletUnlock(passphrase: string|null = null): Promise<boolean>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to check if the wallet exists.');
			return false;
		}
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase);
		// List all wallet keys
		const output: string|null = await containerCommand(['process', 'keys', 'list'], stdin);
		
		// If an error occurred
		if (output === null || !output.includes('Name'))
			return false;
		
		// Passphrase can unlock the wallet
		return true;
	}
	
	/**
	 * Check if the wallet exists
	 * @param passphrase string|null
	 * @returns boolean|undefined
	 */
	public async walletExists(passphrase: string|null = null): Promise<boolean|undefined>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to check if the wallet exists.');
			return undefined;
		}
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase);
		
		// If wallet name if empty
		if (this.nodeConfig.wallet_name.trim().length === 0)
			return undefined;
		
		// List all wallet keys
		const output: string|null = await containerCommand(['process', 'keys', 'list'], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Return if the wallet exists
		return output !== null && output.includes(this.nodeConfig.wallet_name);
	}
	
	/**
	 * Remove wallet keys
	 * @param passphrase: string|null
	 * @returns boolean|undefined
	 */
	public async walletRemove(passphrase: string|null = null): Promise<boolean|undefined>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to remove the wallet.');
			return false;
		}
		
		// Check if wallet does not exists or passphrase is invalid
		const exists = await this.walletExists(passphrase);
		if (!exists || exists === undefined)
			return exists === undefined ? undefined : true;
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase);
		
		// Remove wallet keys
		const output: string|null = await containerCommand(['process', 'keys', 'delete', this.nodeConfig.wallet_name], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// If the wallet has been removed
		if (output === '')
		{
			// Reset the addresses
			this.nodeConfig.walletPublicAddress = '';
			this.nodeConfig.walletNodeAddress = '';
			// Return success
			return true;
		}
		// Else, return an error
		return false;
	}
	
	/**
	 * Load wallet addresses (node address + public address)
	 * @param passphrase: string|null
	 * @returns boolean|undefined
	 */
	public async walletLoadAddresses(passphrase: string|null = null): Promise<boolean|undefined>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to load the wallet addresses.');
			return false;
		}
		
		// If wallet does not exist, return false
		const exists = await this.walletExists(passphrase);
		if (exists === undefined)
			return undefined;
		else if (!exists)
		{
			// Reset the addresses
			this.nodeConfig.walletPublicAddress = '';
			this.nodeConfig.walletNodeAddress = '';
			// Return an error
			return false;
		}
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase);
		
		// Remove wallet keys
		const output: string|null = await containerCommand(['process', 'keys', 'show'], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse lines to find the wallet addresses
		const lines = output?.split('\n') || [];
		for (let line of lines)
		{
			// Find the line containing the wallet name
			if (line.includes(this.nodeConfig.wallet_name))
			{
				// Split the line to extract the addresses
				const parts = line.trim()
					.split(/\s+/);
				if (parts.length === 3)
				{
					// Store the addresses
					this.nodeConfig.walletNodeAddress = parts[1];
					this.nodeConfig.walletPublicAddress = parts[2];
					// Return success
					return true;
				}
			}
		}
		
		// Reset the addresses
		this.nodeConfig.walletPublicAddress = '';
		this.nodeConfig.walletNodeAddress = '';
		// Return an error if the addresses have not been loaded
		return false;
	}
	
	/**
	 * Create a new wallet
	 * @param passphrase: string|null
	 * @returns string[]|null|undefined
	 */
	public async walletCreate(passphrase: string|null = null): Promise<string[]|null|undefined>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to create a new wallet.');
			return null;
		}
		
		// Check if wallet exists, return error if it does
		const exists = await this.walletExists(passphrase);
		if (exists)
			return exists === undefined ? undefined : null;
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase, 2);
		
		// Create new wallet
		const output: string|null = await containerCommand(['process', 'keys', 'add'], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse the output
		const parsedOutput = this.parseKeysAddOutput(output);
		
		// If the node address and public address have been extracted
		if (parsedOutput && parsedOutput.nodeAddress && parsedOutput.publicAddress && parsedOutput.mnemonicArray.length === 24)
		{
			// Store the addresses
			this.nodeConfig.walletNodeAddress = parsedOutput.nodeAddress as string;
			this.nodeConfig.walletPublicAddress = parsedOutput.publicAddress as string;
			// Return the mnemonic
			return parsedOutput.mnemonicArray as string[];
		}
		
		// An error occurred
		return null;
	}
	
	/**
	 * Recover wallet from mnemonic phrase
	 * @param mnemonic: string
	 * @param passphrase: string|null|undefined
	 * @returns boolean
	 */
	public async walletRecover(mnemonic: string|string[], passphrase: string|null = null): Promise<boolean|undefined>
	{
		// If passphrase required and not provided
		if (!this.isPassphraseValid(passphrase))
		{
			Logger.error('Passphrase is required to recover the wallet.');
			return false;
		}
		
		// Check if wallet exists, return error if it does
		const exists = await this.walletExists(passphrase);
		if (exists)
			return exists === undefined ? undefined : false;
		
		// Convert string[] to string
		if (Array.isArray(mnemonic))
			mnemonic = mnemonic.join(' ');
		
		// Stdin for the command
		let stdin: string[]|null = this.buildStdinCommand(passphrase, 2, [mnemonic]);
		
		// Recoverr new wallet
		const output: string|null = await containerCommand(['process', 'keys', 'add', '--recover'], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse the output
		const parsedOutput = this.parseKeysAddOutput(output);
		// If the node address and public address have been extracted
		if (parsedOutput && parsedOutput.nodeAddress && parsedOutput.publicAddress && parsedOutput.mnemonicArray.length === 24)
		{
			// Store the addresses
			this.nodeConfig.walletNodeAddress = parsedOutput.nodeAddress as string;
			this.nodeConfig.walletPublicAddress = parsedOutput.publicAddress as string;
			// Return success
			return true;
		}
		
		// An error occurred, return false
		return false;
	}
	
	/**
	 * Parse the output of the keys add command
	 * @param output: string
	 * @returns { [key: string]: string | string[] } | null
	 */
	private parseKeysAddOutput(output: string): { [key: string]: string | string[] } | null
	{
		// Regex to extract data
		const nodeAddressRegex = /\bsentnode\w+\b/;
		const publicAddressRegex = /\bsent(?!node)\w+\b/;
		const mnemonicRegex = /^(?!.*\*\*Important\*\*)\b(?:\w+\s+){23}\w+\b/m;
		
		// Extract node address
		const nodeAddressMatch = output.match(nodeAddressRegex);
		const nodeAddress = nodeAddressMatch ? nodeAddressMatch[0] : '';
		
		// Extract public address
		const publicAddressMatch = output.match(publicAddressRegex);
		const publicAddress = publicAddressMatch ? publicAddressMatch[0] : '';
		
		// Extract mnemonic phrase
		const mnemonicMatch = output.match(mnemonicRegex);
		const mnemonicArray = mnemonicMatch
			? mnemonicMatch[0].trim()
				.split(/\s+/)
			: [];
		
		// If the node address and public address have been extracted
		if (nodeAddress && publicAddress && mnemonicArray.length === 24)
		{
			// Return data
			return {
				nodeAddress: nodeAddress,
				publicAddress: publicAddress,
				mnemonicArray: mnemonicArray,
			};
		}
		// Else, return null
		return null;
	}
	
	/**
	 * Get wallet balance
	 * @param publicAddress string|null
	 * @returns Promise<BalanceWallet>
	 */
	public async getWalletBalance(publicAddress: string|null = null): Promise<BalanceWallet>
	{
		let apiResponse: BalancesResponse|null = null;
		
		// Default wallet balance
		let walletBalance: BalanceWallet =
		{
			denom: 'DVPN',
			amount: 0,
		};
		
		// If address is empty, use the node address
		if (publicAddress === null || publicAddress.trim().length === 0)
			publicAddress = this.nodeConfig.walletPublicAddress;
		
		// If address is still empty, return 0 balance
		if (publicAddress === null || publicAddress.trim().length === 0)
			return walletBalance;
		
		// Try each API endpoint
		for (const url of config.API_BALANCE)
		{
			try
			{
				// Get wallet balance
				const response = await axios.get(`${url}${publicAddress}`, { timeout: 60000 });
				if (response.data)
				{
					apiResponse = response.data as BalancesResponse;
					break;
				}
				else
				{
					Logger.error(`API ${url} returned an empty response.`);
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			catch (_error)
			{
				Logger.error(`API ${url} is unreachable. Trying another API...`);
			}
		}
		
		// If the API response is invalid
		if (!apiResponse)
		{
			Logger.error('Failed to retrieve wallet balance.');
			return walletBalance;
		}
		
		// Find the DVPN balance
		const dvpnObject = apiResponse.balances?.find((balance: any) => balance.denom === 'udvpn');
		if (dvpnObject)
		{
			// Convert the balance (udvpn) to DVPN
			walletBalance.amount = parseInt(dvpnObject.amount, 10) / 1000000;
		}
		
		// Return the wallet balance formatted
		return walletBalance;
	}
	
	/**
	 * Get the node status from http://localhost:xxxxx/status
	 * @returns Promise<NodeStatus|null>
	 */
	public async getNodeStatus(): Promise<NodeStatus>
	{
		let results: NodeStatus =
		{
			type: 0,
			version: 'N/A',
			peers: 0,
			max_peers: 0,
			bandwidth:
			{
				download: 0,
				upload: 0,
			},
			handshake:
			{
				enable: false,
				peers: 0,
			},
			location:
			{
				city: 'N/A',
				country: 'N/A',
				latitude: 0,
				longitude: 0,
			},
		};
		
		try
		{
			// Ignore self-signed SSL certificate
			const httpsAgent = new https.Agent({
				rejectUnauthorized: false
			});
			// Node status URL
			const statusUrl = `https://localhost:${this.nodeConfig.node_port}/status`;
			Logger.info(`Getting node status from ${statusUrl}`);
			// Attempt to get the node status
			const response = await axios.get(statusUrl, { timeout: 15000, httpsAgent });
			// If the response is valid
			if (response.status === 200 && response.data?.success === true)
			{
				// Extract the node status
				const data = response.data.result;
				// Update the results
				results =
				{
					type: data.type || 0,
					version: data.version || 'N/A',
					peers: data?.peers || 0,
					max_peers: data?.qos?.max_peers || 0,
					bandwidth:
					{
						download: data?.bandwidth?.download || 0,
						upload: data?.bandwidth?.upload || 0,
					},
					handshake:
					{
						enable: data?.handshake?.enable || false,
						peers: data?.handshake?.peers || 0,
					},
					location:
					{
						city: data?.location?.city || 'N/A',
						country: data?.location?.country || 'N/A',
						latitude: data?.location?.latitude || 0,
						longitude: data?.location?.longitude || 0,
					},
				};
			}
			else
			{
				Logger.error('Failed to get the node status.');
			}
		}
		catch (error)
		{
			Logger.error(`Failed to get the node status: ${error}`);
		}
		
		return results;
	}
	
	/**
	 * Get the node status
	 * @returns Promise<string>
	 */
	public async getStatus(): Promise<string>
	{
		const install = await checkInstallation();
		
		// Detect if the node is installed
		if (install.image === false
			|| install.containerExists === false
			|| install.nodeConfig === false
			|| install.vpnConfig === false
			|| install.certificateKey === false
			|| install.wallet === false)
			return 'uninstalled';
		
		// Detect if the node is running
		if (install.containerRunning)
			return 'running';
		else
			return 'stopped';
	}
	
	/**
	 * Set moniker but do not save it to the configuration file
	 * @param moniker string
	 * @return void
	 */
	public setMoniker(moniker: string): void
	{
		this.nodeConfig.moniker = moniker;
	}
	
	/**
	 * Set node type but do not save it to the configuration file
	 * @param nodeType string
	 * @returns void
	 */
	public setNodeType(nodeType: string): void
	{
		this.nodeConfig.node_type = nodeType;
		// Set the prices based on the node type
		if (this.nodeConfig.node_type === 'datacenter')
		{
			this.nodeConfig.gigabyte_prices = DATACENTER_GIGABYTE_PRICES;
			this.nodeConfig.hourly_prices = DATACENTER_HOURLY_PRICES;
		}
		else if (this.nodeConfig.node_type === 'residential')
		{
			this.nodeConfig.gigabyte_prices = RESIDENTIAL_GIGABYTE_PRICES;
			this.nodeConfig.hourly_prices = RESIDENTIAL_HOURLY_PRICES;
		}
	}
	
	/**
	 * Set node ip but do not save it to the configuration file
	 * @param nodeIp string
	 * @returns void
	 */
	public setNodeIp(nodeIp: string): void
	{
		this.nodeConfig.node_ip = nodeIp;
	}
	
	/**
	 * Set node port but do not save it to the configuration file
	 * @param nodePort number
	 * @returns void
	 */
	public setNodePort(nodePort: number): void
	{
		this.nodeConfig.node_port = nodePort;
	}
	
	/**
	 * Set node type but do not save it to the configuration file
	 * @param vpnType string
	 * @returns void
	 */
	public setVpnType(vpnType: string): void
	{
		this.nodeConfig.vpn_type = vpnType;
		// Update handshake configuration based on the VPN type
		this.nodeConfig.handshake = vpnType === 'wireguard' ? true : false;
	}
	
	/**
	 * Set VPN port but do not save it to the configuration file
	 * @param vpnPort number
	 * @returns void
	 */
	public setVpnPort(vpnPort: number): void
	{
		this.nodeConfig.vpn_port = vpnPort;
	}
	
	/**
	 * Set maximum peers but do not save it to the configuration file
	 * @param maxPeers number
	 * @returns void
	 */
	public setMaxPeers(maxPeers: number): void
	{
		this.nodeConfig.max_peers = maxPeers;
	}
	
	/**
	 * Set system uptime
	 * @param uptime: number
	 */
	public setSystemUptime(uptime: number): void
	{
		this.nodeConfig.systemUptime = uptime;
	}
	
	/**
	 * Set system OS
	 * @param os: string
	 */
	public setSystemOs(os: string): void
	{
		this.nodeConfig.systemOs = os;
	}
	/**
	 * Set system kernel
	 * @param kernel: string
	 */
	public setSystemKernel(kernel: string): void
	{
		this.nodeConfig.systemKernel = kernel;
	}
	
	/**
	 * Set system architecture
	 * @param arch: string
	 */
	public setSystemArch(arch: string): void
	{
		this.nodeConfig.systemArch = arch;
	}
	
	/**
	 * Check if the passphrase is required
	 * @returns boolean
	 */
	public passphraseRequired(): boolean
	{
		if (this.nodeConfig.backend !== 'file')
			return false;
		// Check if the keyring folder exists
		const keyringPath = path.join(config.CONFIG_DIR, 'keyring-file');
		if (fs.existsSync(keyringPath))
		{
			// Check if the keyring folder contains any address files
			const files = fs.readdirSync(keyringPath);
			return files.some((file) => file.endsWith('.address'));
		}
		return false;
	}
	
	/**
	 * Check if the passphrase can be used
	 * @returns boolean
	 */
	public passphraseAvailable(): boolean
	{
		return (this.passphraseRequired() && this.nodeConfig.walletPassphrase.trim().length > 0)
				|| (!this.passphraseRequired());
	}
	
	/**
	 * Set the passphrase
	 * @param passphrase string
	 * @returns void
	 */
	public setPassphrase(passphrase: string): void
	{
		this.nodeConfig.walletPassphrase = passphrase;
	}
	
	/**
	 * Set the mnemonic
	 */
	public setMnemonic(mnemonic: string[]): void
	{
		this.nodeConfig.walletMnemonic = mnemonic;
	}
	
	/**
	 * Set the backend
	 */
	public setBackend(backend: string): void
	{
		this.nodeConfig.backend = backend;
	}
}

// Create a singleton instance of NodeManager
const nodeManager = NodeManager.getInstance();
export default nodeManager;

// Export utility functions
export const nodeConfig = (): NodeConfigData => nodeManager.getConfig();
export const isNodeConfigFileAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'config.toml'));
export const isWireguardConfigFileAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'wireguard.toml'));
export const isV2RayConfigFileAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'v2ray.toml'));
export const isCertificateKeyAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'tls.key'));
export const isWalletAvailable = (): Promise<boolean> => nodeManager.isWalletAvailable();
export const createNodeConfig = (): Promise<boolean> => nodeManager.createNodeConfig();
export const createVpnConfig = (): Promise<boolean> => nodeManager.createVpnConfig();
export const passphraseRequired = (): boolean => nodeManager.passphraseRequired();
export const passphraseAvailable = (): boolean => nodeManager.passphraseAvailable();
export const walletUnlock = (passphrase: string|null = null): Promise<boolean> => nodeManager.walletUnlock(passphrase);
export const walletExists = (passphrase: string|null = null): Promise<boolean|undefined> => nodeManager.walletExists(passphrase);
export const walletRemove = (passphrase: string|null = null): Promise<boolean|undefined> => nodeManager.walletRemove(passphrase);
export const walletLoadAddresses = (passphrase: string|null = null): Promise<boolean|undefined> => nodeManager.walletLoadAddresses(passphrase);
export const walletCreate = (passphrase: string|null = null): Promise<string[]|null|undefined> => nodeManager.walletCreate(passphrase);
export const walletRecover = (mnemonic: string|string[], passphrase: string|null = null): Promise<boolean|undefined> => nodeManager.walletRecover(mnemonic, passphrase);
export const walletBalance = (publicAddress: string|null = null): Promise<BalanceWallet> => nodeManager.getWalletBalance(publicAddress);
export const getNodeStatus = (): Promise<NodeStatus|null> => nodeManager.getNodeStatus();
export const vpnChangeType = (): Promise<boolean> => nodeManager.vpnChangeType();