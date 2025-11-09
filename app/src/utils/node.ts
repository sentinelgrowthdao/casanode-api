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
	node_ipv6: string;
	vpn_type: string;
	vpn_protocol?: string;
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
		chain_id: DEFAULT_CHAIN_ID,
		rpc_addresses: DEFAULT_RPC_ADDRESSES.join(','),
		node_ip: '',
		node_ipv6: '',
		vpn_type: 'wireguard',
		vpn_protocol: 'udp',
		node_port: 0,
		vpn_port: 0,
		backend: 'test',
		handshake: true,
		wallet_name: 'operator',
		max_peers: 250,
		gas: '200000',
		gas_adjustment: '1.05',
		gas_prices: '0.2udvpn',
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
			return;
		}
		
		try
		{
			// Load configuration file content
			const configFileContent = fs.readFileSync(configFilePath, 'utf8');
			
			this.nodeConfig.moniker = this.extractConfigValueInSection(configFileContent, 'node', 'moniker') || '';
			this.nodeConfig.vpn_type = this.extractConfigValueInSection(configFileContent, 'node', 'service_type') || 'wireguard';
			
			const apiPortEntry = this.extractFirstListItem(this.extractConfigValueInSection(configFileContent, 'node', 'api_port'));
			const parsedApi = this.parseEndpoint(apiPortEntry);
			if (parsedApi.port !== undefined)
				this.nodeConfig.node_port = parsedApi.port;
			if (parsedApi.ip)
				this.nodeConfig.node_ip = parsedApi.ip;
			
			const remoteAddrsRaw = this.extractConfigValueInSection(configFileContent, 'node', 'remote_addrs');
			const remoteAddrs = this.parseTomlArray(remoteAddrsRaw).map((addr) => this.normalizeAddress(addr));
			const remoteHostCandidates = remoteAddrs.map((addr) => this.extractHost(addr)).filter((addr) => addr.length > 0);
			if (remoteHostCandidates.length)
			{
				if (!this.nodeConfig.node_ip || this.nodeConfig.node_ip === '0.0.0.0')
					this.nodeConfig.node_ip = remoteHostCandidates[0];
				const ipv6Candidate = remoteHostCandidates.find((addr) => this.isIPv6Address(addr));
				if (ipv6Candidate)
					this.nodeConfig.node_ipv6 = ipv6Candidate;
			}
			if (!this.nodeConfig.node_ip || this.nodeConfig.node_ip.trim().length === 0)
				this.nodeConfig.node_ip = '0.0.0.0';
			
			this.nodeConfig.chain_id = this.extractConfigValueInSection(configFileContent, 'rpc', 'chain_id') || DEFAULT_CHAIN_ID;
			const rpcAddrsRaw = this.extractConfigValueInSection(configFileContent, 'rpc', 'addrs');
			const rpcAddrsList = this.parseTomlArray(rpcAddrsRaw).map((addr) => this.normalizeAddress(addr));
			if (rpcAddrsList.length)
				this.nodeConfig.rpc_addresses = rpcAddrsList.join(',');
			else if (rpcAddrsRaw)
				this.nodeConfig.rpc_addresses = this.normalizeAddress(rpcAddrsRaw);
			else
				this.nodeConfig.rpc_addresses = DEFAULT_RPC_ADDRESSES.join(',');
			
			const maxPeersValue = this.extractConfigValueInSection(configFileContent, 'qos', 'max_peers');
			const maxPeersParsed = parseInt(maxPeersValue || '', 10);
			this.nodeConfig.max_peers = Number.isFinite(maxPeersParsed) && maxPeersParsed > 0 ? maxPeersParsed : 250;
			this.nodeConfig.backend = this.extractConfigValueInSection(configFileContent, 'keyring', 'backend') || 'test';
			const walletName = this.extractConfigValueInSection(configFileContent, 'tx', 'from_name');
			this.nodeConfig.wallet_name = walletName && walletName.trim().length > 0 ? walletName : 'operator';
			this.nodeConfig.handshake = this.parseBoolean(this.extractConfigValueInSection(configFileContent, 'handshake_dns', 'enable'));
			this.nodeConfig.gas = this.extractConfigValue(configFileContent, 'gas');
			this.nodeConfig.gas_adjustment = this.extractConfigValue(configFileContent, 'gas_adjustment');
			this.nodeConfig.gas_prices = this.extractConfigValue(configFileContent, 'gas_prices');
			this.nodeConfig.gigabyte_prices = this.extractConfigValue(configFileContent, 'gigabyte_prices');
			this.nodeConfig.hourly_prices = this.extractConfigValue(configFileContent, 'hourly_prices');
			
			if (this.nodeConfig.hourly_prices === DATACENTER_HOURLY_PRICES)
				this.nodeConfig.node_type = 'datacenter';
			else if (this.nodeConfig.hourly_prices && this.nodeConfig.hourly_prices.trim().length > 0)
				this.nodeConfig.node_type = 'residential';
			else
				this.nodeConfig.node_type = '';
			
			this.nodeConfig.vpn_port = 0;
			this.nodeConfig.vpn_protocol = undefined;
			this.loadVpnConfig();
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
		// Update IPv6 information when available
		if (remoteAddress.ipv6)
			this.nodeConfig.node_ipv6 = remoteAddress.ipv6;
	}
	
	/**
	 * Extract configuration value from the content
	 * @param content - File content
	 * @param key - Configuration key
	 * @returns string
	 */
	private extractConfigValue(content: string, key: string): string
	{
		const regex = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
		const match = content.match(regex);
		return match ? this.cleanTomlValue(match[1]) : '';
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
		const sectionRegex = new RegExp(`\\[${section}\\]([\\s\\S]*?)(?=\\r?\\n\\[|$)`);
		const sectionMatch = content.match(sectionRegex);
		// If the section is found, extract the key value
		if (!sectionMatch)
			return '';
		
		// Create a regex to match the key
		const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
		const keyMatch = sectionMatch[1].match(keyRegex);
		return keyMatch ? this.cleanTomlValue(keyMatch[1]) : '';
	}
	
	/**
	 * Clean TOML value by removing surrounding quotes
	 * @param value - TOML value
	 * @returns string
	 */
	private cleanTomlValue(value: string): string
	{
		const trimmed = value.trim();
		if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\'')))
			return trimmed.slice(1, -1);
		return trimmed;
	}
	
	/**
	 * Remove surrounding quotes from a value
	 * @param value string
	 * @returns string
	 */
	private stripQuotes(value: string): string
	{
		const trimmed = value.trim();
		if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\'')))
			return trimmed.slice(1, -1);
		return trimmed;
	}

	/**
	 * Extract the first item from a TOML list-like string
	 * @param value string | undefined
	 * @returns string
	 */
	private extractFirstListItem(value?: string): string
	{
		if (!value)
			return '';
		let normalized = value.trim();
		if (normalized.startsWith('[') && normalized.endsWith(']'))
			normalized = normalized.slice(1, -1).trim();
		const commaIndex = normalized.indexOf(',');
		if (commaIndex !== -1)
			normalized = normalized.slice(0, commaIndex);
		return this.stripQuotes(normalized.trim());
	}

	/**
	 * Normalize a raw address by trimming and removing quotes
	 * @param value string
	 * @returns string
	 */
	private normalizeAddress(value: string): string
	{
		return this.stripQuotes(value).trim();
	}

	/**
	 * Extract the host portion of an address, stripping ports and IPv6 brackets
	 * @param address string
	 * @returns string
	 */
	private extractHost(address: string): string
	{
		let normalized = address.trim();
		if (!normalized)
			return '';
		if (normalized.startsWith('['))
		{
			const closing = normalized.indexOf(']');
			if (closing > 0)
			{
				normalized = normalized.slice(1, closing);
			}
		}
		else
		{
			const lastColonIndex = normalized.lastIndexOf(':');
			if (lastColonIndex > -1 && normalized.indexOf(':') === lastColonIndex)
			{
				const portCandidate = normalized.slice(lastColonIndex + 1).trim();
				if (/^\d+$/.test(portCandidate))
					normalized = normalized.slice(0, lastColonIndex);
			}
		}
		return normalized;
	}

	/**
	 * Determine if the provided address is IPv6
	 * @param address string
	 * @returns boolean
	 */
	private isIPv6Address(address: string): boolean
	{
		return address.includes(':') && !address.includes('::ffff:');
	}

	/**
	 * Parse a boolean value from string
	 * @param value string | undefined
	 * @returns boolean
	 */
	private parseBoolean(value?: string): boolean
	{
		if (!value)
			return false;
		const normalized = value.trim().toLowerCase();
		return ['true', '1', 'yes', 'on'].includes(normalized);
	}

	/**
	 * Parse a port entry extracting last numeric token
	 * @param value string
	 * @returns number | undefined
	 */
	private parsePortValue(value: string): number | undefined
	{
		const normalized = this.stripQuotes(value).trim();
		if (!normalized)
			return undefined;
		const segments = normalized.split(':');
		const lastSegment = segments[segments.length - 1]?.trim() ?? '';
		if (/^\d+$/.test(lastSegment))
			return parseInt(lastSegment, 10);
		return undefined;
	}
	
	/**
	 * Parse a TOML array string into an array of strings
	 * @param value - TOML array string
	 * @returns string[]
	 */
	private parseTomlArray(value: string): string[]
	{
		if (!value)
			return [];
		let normalized = value.trim();
		if (normalized.startsWith('[') && normalized.endsWith(']'))
			normalized = normalized.slice(1, -1);
		return normalized.split(',')
			.map((item) => this.stripQuotes(item.trim()))
			.filter((item) => item.length > 0);
	}
	
	/**
	 * Parse an endpoint string into IP and port
	 * @param entry - Endpoint string
	 * @returns { ip?: string; port?: number }
	 */
	private parseEndpoint(entry: string): { ip?: string; port?: number }
	{
		if (!entry)
			return {};
		
		const cleaned = this.stripQuotes(entry);
		if (!cleaned)
			return {};
		
		if (cleaned.startsWith('['))
		{
			const closingIndex = cleaned.indexOf(']');
			const ip = cleaned.slice(1, closingIndex);
			const portSegment = cleaned.slice(closingIndex + 1);
			const port = portSegment.startsWith(':') ? parseInt(portSegment.slice(1), 10) : undefined;
			return {
				ip,
				port: Number.isFinite(port) ? port : undefined
			};
		}
		
		if (/^\d+$/.test(cleaned))
			return { port: parseInt(cleaned, 10) };
		
		const lastColonIndex = cleaned.lastIndexOf(':');
		if (lastColonIndex > -1 && cleaned.indexOf(':') === lastColonIndex)
		{
			const ip = cleaned.slice(0, lastColonIndex);
			const port = parseInt(cleaned.slice(lastColonIndex + 1), 10);
			return {
				ip,
				port: Number.isFinite(port) ? port : undefined
			};
		}
		
		return { ip: cleaned };
	}
	
	/**
	 * Load VPN configuration based on the current VPN type
	 */
	private loadVpnConfig(): void
	{
		const wireguardConfigPath = path.join(config.CONFIG_DIR, 'wireguard', 'config.toml');
		const v2rayConfigPath = path.join(config.CONFIG_DIR, 'v2ray', 'config.toml');
		const openvpnConfigPath = path.join(config.CONFIG_DIR, 'openvpn', 'config.toml');

		if (this.nodeConfig.vpn_type === 'wireguard')
		{
			this.nodeConfig.vpn_protocol = 'udp';
			if (this.isConfigFileAvailable(wireguardConfigPath))
			{
				try
				{
					const wireguardConfigContent = fs.readFileSync(wireguardConfigPath, 'utf8');
					const portValue = this.extractConfigValue(wireguardConfigContent, 'port');
					const parsedPort = portValue ? this.parsePortValue(portValue) : undefined;
					if (parsedPort !== undefined)
						this.nodeConfig.vpn_port = parsedPort;
				}
				catch (error)
				{
					Logger.error(`Error loading WireGuard configuration: ${error}`);
				}
			}
			return;
		}

		if (this.nodeConfig.vpn_type === 'v2ray')
		{
			this.nodeConfig.vpn_protocol = 'tcp';
			if (this.isConfigFileAvailable(v2rayConfigPath))
			{
				try
				{
					const v2rayConfigContent = fs.readFileSync(v2rayConfigPath, 'utf8');
					const portValue = this.extractConfigValue(v2rayConfigContent, 'port');
					const parsedPort = portValue ? this.parsePortValue(portValue) : undefined;
					if (parsedPort !== undefined)
						this.nodeConfig.vpn_port = parsedPort;
				}
				catch (error)
				{
					Logger.error(`Error loading V2Ray configuration: ${error}`);
				}
			}
			return;
		}

		if (this.nodeConfig.vpn_type === 'openvpn')
		{
			if (this.isConfigFileAvailable(openvpnConfigPath))
			{
				try
				{
					const openvpnConfigContent = fs.readFileSync(openvpnConfigPath, 'utf8');
					const portValue = this.extractConfigValue(openvpnConfigContent, 'port');
					const parsedPort = portValue ? this.parsePortValue(portValue) : undefined;
					if (parsedPort !== undefined)
						this.nodeConfig.vpn_port = parsedPort;
					const protocolValue = this.extractConfigValue(openvpnConfigContent, 'protocol');
					const normalizedProtocol = protocolValue ? this.stripQuotes(protocolValue).trim().toLowerCase() : '';
					this.nodeConfig.vpn_protocol = normalizedProtocol === 'tcp' ? 'tcp' : 'udp';
				}
				catch (error)
				{
					Logger.error(`Error loading OpenVPN configuration: ${error}`);
				}
			}
			else
			{
				this.nodeConfig.vpn_protocol = 'udp';
			}
			return;
		}

		// Default fallback
		if (!this.nodeConfig.vpn_protocol)
			this.nodeConfig.vpn_protocol = 'udp';
	}
	
	/**
	 * Build remote addresses list
	 * @returns string[]
	 */
	private buildRemoteAddressesList(): string[]
	{
		const addresses: string[] = [];
		if (this.nodeConfig.node_ip && this.nodeConfig.node_ip !== '0.0.0.0')
			addresses.push(this.nodeConfig.node_ip);
		if (this.nodeConfig.node_ipv6 && this.nodeConfig.node_ipv6 !== '::1')
			addresses.push(this.nodeConfig.node_ipv6);
		if (!addresses.length)
			addresses.push('127.0.0.1');
		return [...new Set(addresses)];
	}
	
	/**
	 * Format remote addresses for TOML
	 * @param addresses string[]
	 * @returns string
	 */
	private formatRemoteAddresses(addresses: string[]): string
	{
		if (!addresses.length)
			return '["127.0.0.1"]';
		return `[${addresses.map((addr) => `"${addr}"`).join(', ')}]`;
	}
	
	/**
	 * Get RPC addresses as an array
	 * @returns string[]
	 */
	private getRpcAddresses(): string[]
	{
		const parsed = this.parseTomlArray(this.nodeConfig.rpc_addresses);
		if (parsed.length)
			return parsed;
		
		return this.nodeConfig.rpc_addresses
			.split(',')
			.map((addr) => addr.replace(/[\[\]"]/g, '').trim())
			.filter((addr) => addr.length > 0);
	}
	
	/**
	 * Format RPC addresses for TOML
	 * @returns string
	 */
	private formatRpcAddresses(): string
	{
		const rpcAddresses = this.getRpcAddresses();
		if (!rpcAddresses.length)
			return '[]';
		return `[${rpcAddresses.map((addr) => `"${addr}"`).join(', ')}]`;
	}
	
	/**
	 * Format a value for TOML
	 * @param value - Value to format
	 * @param quote - Whether to quote the value
	 * @returns string
	 */
	private formatTomlValue(value: string | number | boolean, quote?: boolean): string
	{
		if (typeof value === 'number' || typeof value === 'boolean')
			return `${value}`;
		
		if (quote === false)
			return value;
		
		if (quote === true)
			return `"${value}"`;
		
		const trimmed = value.trim();
		if (trimmed.startsWith('[') || trimmed.startsWith('{'))
			return value;
		
		return `"${value}"`;
	}

	/**
	 * Refresh node configuration files
	 */
	public refreshConfigFiles(): void
	{
		const configFilePath = path.join(config.CONFIG_DIR, 'config.toml');
		
		try
		{
			this.updateConfigValueInSection(configFilePath, 'node', 'moniker', this.nodeConfig.moniker);
			this.updateConfigValueInSection(configFilePath, 'node', 'service_type', this.nodeConfig.vpn_type);
			this.updateConfigValueInSection(configFilePath, 'node', 'api_port', this.nodeConfig.node_port.toString(), { quote: true });
			const remoteAddrsValue = this.formatRemoteAddresses(this.buildRemoteAddressesList());
			this.updateConfigValueInSection(configFilePath, 'node', 'remote_addrs', remoteAddrsValue, { quote: false });
			
			this.updateConfigValueInSection(configFilePath, 'rpc', 'chain_id', this.nodeConfig.chain_id);
			this.updateConfigValueInSection(configFilePath, 'rpc', 'addrs', this.formatRpcAddresses(), { quote: false });
			this.updateConfigValueInSection(configFilePath, 'keyring', 'backend', this.nodeConfig.backend);
			this.updateConfigValueInSection(configFilePath, 'tx', 'from_name', this.nodeConfig.wallet_name);
			this.updateConfigValueInSection(configFilePath, 'handshake_dns', 'enable', this.nodeConfig.handshake ? 'true' : 'false', { quote: false });
			this.updateConfigValueInSection(configFilePath, 'qos', 'max_peers', this.nodeConfig.max_peers, { quote: false });
			
			this.updateConfigValue(configFilePath, 'gas', this.nodeConfig.gas, { quote: false });
			this.updateConfigValue(configFilePath, 'gas_adjustment', this.nodeConfig.gas_adjustment, { quote: false });
			this.updateConfigValue(configFilePath, 'gas_prices', this.nodeConfig.gas_prices);
			
			if (this.nodeConfig.node_type === 'residential')
			{
				this.updateConfigValue(configFilePath, 'gigabyte_prices', RESIDENTIAL_GIGABYTE_PRICES);
				this.updateConfigValue(configFilePath, 'hourly_prices', RESIDENTIAL_HOURLY_PRICES);
			}
			else
			{
				this.updateConfigValue(configFilePath, 'gigabyte_prices', DATACENTER_GIGABYTE_PRICES);
				this.updateConfigValue(configFilePath, 'hourly_prices', DATACENTER_HOURLY_PRICES);
			}
			
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
		const wireguardConfigPath = path.join(config.CONFIG_DIR, 'wireguard', 'config.toml');
		const v2rayConfigPath = path.join(config.CONFIG_DIR, 'v2ray', 'config.toml');
		const openvpnConfigPath = path.join(config.CONFIG_DIR, 'openvpn', 'config.toml');
		
		// Get the current VPN type
		const current_vpn_type = this.extractConfigValueInSection(fs.readFileSync(configFilePath, 'utf8'), 'node', 'service_type');
		// Get the VPN port
		const current_vpn_port = this.nodeConfig.vpn_port;
		
		// If the VPN type is not changed, do nothing
		if (current_vpn_type === this.nodeConfig.vpn_type)
		{
			Logger.info('VPN type has not been changed.');
			
			// If the configuration file exists, update the VPN port
			if (this.nodeConfig.vpn_type === 'wireguard')
			{
				this.updateConfigValue(wireguardConfigPath, 'port', current_vpn_port, { quote: true });
			}
			else if (this.nodeConfig.vpn_type === 'v2ray')
			{
				this.updateConfigValue(v2rayConfigPath, 'port', current_vpn_port, { quote: false });
			}
			else if (this.nodeConfig.vpn_type === 'openvpn')
			{
				this.updateConfigValue(openvpnConfigPath, 'port', current_vpn_port, { quote: true });
				if (this.nodeConfig.vpn_protocol)
					this.updateConfigValue(openvpnConfigPath, 'protocol', this.nodeConfig.vpn_protocol, { quote: true });
			}
			return true;
		}
		
		// Change the VPN type in the node configuration file
		this.updateConfigValueInSection(configFilePath, 'node', 'service_type', this.nodeConfig.vpn_type);
		// Change the handshake enable in the node configuration file
		this.updateConfigValueInSection(configFilePath, 'handshake_dns', 'enable', this.nodeConfig.vpn_type === 'wireguard' ? 'true' : 'false', { quote: false });
		
		// Update VPN configuration files
		if (!await this.createVpnConfig())
			return false;
		
		if (this.nodeConfig.vpn_type === 'wireguard')
		{
			this.updateConfigValue(wireguardConfigPath, 'port', current_vpn_port, { quote: true });
		}
		else if (this.nodeConfig.vpn_type === 'v2ray')
		{
			this.updateConfigValue(v2rayConfigPath, 'port', current_vpn_port, { quote: false });
		}
		else if (this.nodeConfig.vpn_type === 'openvpn')
		{
			this.updateConfigValue(openvpnConfigPath, 'port', current_vpn_port, { quote: true });
			if (this.nodeConfig.vpn_protocol)
				this.updateConfigValue(openvpnConfigPath, 'protocol', this.nodeConfig.vpn_protocol, { quote: true });
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
	private updateConfigValue(filePath: string, key: string, value: string | number | boolean, options: { quote?: boolean } = {}): void
	{
		const regex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
		const content = fs.readFileSync(filePath, 'utf8');
		if (!regex.test(content))
			return;
		
		const formattedValue = this.formatTomlValue(value, options.quote);
		const newContent = content.replace(regex, `${key} = ${formattedValue}`);
		fs.writeFileSync(filePath, newContent, 'utf8');
	}
	
	/**
	 * Update a configuration value in a specific section of a file
	 * @param filePath - Path to the configuration file
	 * @param section - Section name
	 * @param key - Configuration key
	 * @param value - New value
	 */
	private updateConfigValueInSection(filePath: string, section: string, key: string, value: string | number | boolean, options: { quote?: boolean } = {}): void
	{
		const content = fs.readFileSync(filePath, 'utf8');
		const sectionRegex = new RegExp(`(\\[${section}\\][\\s\\S]*?)(?=\\n\\[|$)`, 'm');
		const sectionMatch = content.match(sectionRegex);
		if (!sectionMatch)
			return;
		
		const formattedValue = this.formatTomlValue(value, options.quote);
		const sectionContent = sectionMatch[0];
		const keyRegex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
		if (!keyRegex.test(sectionContent))
			return;
		
		const updatedSection = sectionContent.replace(keyRegex, `${key} = ${formattedValue}`);
		const newContent = content.replace(sectionRegex, updatedSection);
		fs.writeFileSync(filePath, newContent, 'utf8');
	}
	
	private buildInitCommandArguments(): string[]
	{
		const args: string[] = [
			'init',
			'--keyring.backend', this.nodeConfig.backend || 'test',
			'--node.interval-session-usage-sync-with-blockchain', '540s',
			'--node.interval-session-validate', '60s',
			'--node.interval-status-update', '240s',
			'--node.service-type', this.nodeConfig.vpn_type || 'wireguard'
		];
		
		const rpcAddresses = this.getRpcAddresses();
		const fallbackRpc = Array.isArray(config.RPC_ADDRESSES) ? config.RPC_ADDRESSES : DEFAULT_RPC_ADDRESSES;
		const rpcAddress = (rpcAddresses.length ? rpcAddresses : fallbackRpc)[0];
		if (rpcAddress)
			args.push('--rpc.addrs', rpcAddress);
		
		const chainId = this.nodeConfig.chain_id || DEFAULT_CHAIN_ID;
		args.push('--rpc.chain-id', chainId);
		
		const walletName = this.nodeConfig.wallet_name || 'operator';
		args.push('--tx.from-name', walletName);
		
		const remoteAddresses = this.buildRemoteAddressesList().filter((addr) => addr !== '127.0.0.1');
		remoteAddresses.forEach((addr) =>
		{
			args.push('--node.remote-addrs', addr);
		});
		
		return args;
	}
	
	private async runNodeInitCommand(): Promise<boolean>
	{
		const output = await containerCommand(this.buildInitCommandArguments());
		if (output === null)
		{
			Logger.error('Failed to initialize Sentinel configuration.');
			return false;
		}
		return true;
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
		
		const success = await this.runNodeInitCommand();
		
		if (success)
		{
			// Load the node configuration
			await this.loadNodeConfig();
			// Return success
			return true;
		}
		Logger.error('Failed to create node configuration file.');
		return false;
	}
	
	/**
	 * Create VPN configuration file
	 * @returns boolean
	 */
	public async createVpnConfig(): Promise<boolean>
	{
		// Create WireGuard configuration file
		if (this.nodeConfig.vpn_type === 'wireguard')
		{
			// Check if the configuration file already exists
			if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'wireguard', 'config.toml')))
				return true;
			const success = await this.runNodeInitCommand();
			if (success)
				await this.loadNodeConfig();
			return success;
		}
		// Create V2Ray configuration file
		else if (this.nodeConfig.vpn_type === 'v2ray')
		{
			// Check if the configuration file already exists
			if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'v2ray', 'config.toml')))
				return true;
			const success = await this.runNodeInitCommand();
			if (success)
				await this.loadNodeConfig();
			return success;
		}
		else if (this.nodeConfig.vpn_type === 'openvpn')
		{
			if (this.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'openvpn', 'config.toml')))
				return true;
			const success = await this.runNodeInitCommand();
			if (success)
				await this.loadNodeConfig();
			return success;
		}
		
		Logger.error('Invalid VPN type provided.');
		return false;
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
	 * Check if the passphrase is required
	 * @returns boolean
	 */
	private getBackend(): string
	{
		return this.nodeConfig.backend && this.nodeConfig.backend.trim().length > 0 ? this.nodeConfig.backend : 'test';
	}
	
	/**
	 * Check if the passphrase is required
	 * @returns string
	 */
	private getWalletName(): string
	{
		return this.nodeConfig.wallet_name && this.nodeConfig.wallet_name.trim().length > 0 ? this.nodeConfig.wallet_name : 'operator';
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
		const output: string|null = await containerCommand(['keys', 'list', '--keyring.backend', this.getBackend()], stdin);
		
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
		const output: string|null = await containerCommand(['keys', 'list', '--keyring.backend', this.getBackend()], stdin);
		
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
		
		const walletName = this.getWalletName();
		const passRepeat = this.passphraseRequired() ? 2 : 0;
		
		// Stdin for the command (answers for mnemonic)
		let stdin: string[]|null = this.buildStdinCommand(passphrase, passRepeat, ['yes']);
		this.nodeConfig.wallet_name = walletName;
		
		// Remove wallet keys
		const output: string|null = await containerCommand(['keys', 'delete', '--keyring.backend', this.getBackend(), walletName], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// If the wallet has been removed
		if (output === '' || (typeof output === 'string' && /deleted|removed/i.test(output)))
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
		
		const walletName = this.getWalletName();
		this.nodeConfig.wallet_name = walletName;
		const backend = this.getBackend();
		
		let stdin: string[]|null = this.buildStdinCommand(passphrase);
		
		const output: string|null = await containerCommand(['keys', 'show', '--keyring.backend', backend, walletName], stdin);
		
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse the output to extract the addresses
		const publicMatch = output.match(/address:\s*(sent[0-9a-z]+)/i) || output.match(/\bsent(?!node)\w+\b/);
		const nodeMatch = output.match(/\bsentnode\w+\b/);
		
		this.nodeConfig.walletPublicAddress = publicMatch ? (publicMatch[1] || publicMatch[0]) : '';
		this.nodeConfig.walletNodeAddress = nodeMatch ? nodeMatch[0] : '';
		
		// If the public address is empty, return an error
		if (this.nodeConfig.walletPublicAddress.length === 0)
		{
			Logger.error('Failed to parse wallet public address.');
			return false;
		}
		
		return true;
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
		
		const walletName = this.getWalletName();
		const backend = this.getBackend();
		const passRepeat = this.passphraseRequired() ? 2 : 0;
		// Stdin for the command (answers for mnemonic + BIP39 passphrase)
		let stdin: string[]|null = this.buildStdinCommand(passphrase, passRepeat, ['', '']);
		
		// Create new wallet
		const output: string|null = await containerCommand(['keys', 'add', '--keyring.backend', backend, walletName], stdin);
		
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse the output
		const parsedOutput = this.parseKeysAddOutput(output);
		
		// If the node address and public address have been extracted
		if (parsedOutput && parsedOutput.publicAddress && parsedOutput.mnemonicArray.length === 24)
		{
			// Store the addresses
			this.nodeConfig.walletNodeAddress = (parsedOutput.nodeAddress as string) || '';
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
		
		const walletName = this.getWalletName();
		const backend = this.getBackend();
		const passRepeat = this.passphraseRequired() ? 2 : 0;
		// Stdin for the command
		const baseInput: string[] = [mnemonic, ''];
		if (!this.passphraseRequired())
		{
			baseInput.push('');
			baseInput.push('');
		}
		let stdin: string[]|null = this.buildStdinCommand(passphrase, passRepeat, baseInput);
		// Recover new wallet
		const output: string|null = await containerCommand(['keys', 'add', '--keyring.backend', backend, walletName], stdin);
		// Check if the passphrase is incorrect
		if (output === null || isPassphraseError(output))
			return undefined;
		
		// Parse the output
		const parsedOutput = this.parseKeysAddOutput(output);
		// If the node address and public address have been extracted
		if (parsedOutput && parsedOutput.publicAddress)
		{
			// Store the addresses
			this.nodeConfig.walletNodeAddress = (parsedOutput.nodeAddress as string) || '';
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
		// Remove ANSI escape codes to clean the output
		const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
		
		// Regex to extract data
		const nodeAddressRegex = /\bsentnode\w+\b/;
		const publicAddressRegex = /e?address:\s*(sent\w+)/i;
		// Try to capture mnemonic from a "mnemonic: ..." line first, fallback to a generic 24-word match
		const mnemonicLineRegex = /mnemonic:\s*([^\n]+)/i;
		const mnemonicFallbackRegex = /\b(?:[a-z]+(?:\s+|$)){24}\b/i;
		
		// Extract node address
		const nodeAddressMatch = cleanOutput.match(nodeAddressRegex);
		const nodeAddress = nodeAddressMatch ? nodeAddressMatch[0] : '';
		
		// Extract public address
		const publicAddressMatch = cleanOutput.match(publicAddressRegex);
		const publicAddress = publicAddressMatch ? publicAddressMatch[1] : '';
		
		// Extract mnemonic phrase (prefer the explicit "mnemonic:" line)
		let mnemonicArray: string[] = [];
		const mnemonicLineMatch = cleanOutput.match(mnemonicLineRegex);
		if (mnemonicLineMatch && mnemonicLineMatch[1])
		{
			mnemonicArray = mnemonicLineMatch[1].trim().split(/\s+/);
		}
		else
		{
			const mnemonicFallbackMatch = cleanOutput.match(mnemonicFallbackRegex);
			if (mnemonicFallbackMatch)
				mnemonicArray = mnemonicFallbackMatch[0].trim().split(/\s+/);
		}
		
		// If the public address has been extracted (mnemonic may or may not be present)
		if (publicAddress)
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
	 * Set node IPv6 but do not save it to the configuration file
	 * @param nodeIpv6 string
	 * @returns void
	 */
	public setNodeIpv6(nodeIpv6: string): void
	{
		this.nodeConfig.node_ipv6 = nodeIpv6;
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
		if (vpnType === 'wireguard')
			this.nodeConfig.vpn_protocol = 'udp';
		else if (vpnType === 'v2ray')
			this.nodeConfig.vpn_protocol = 'tcp';
		else if (vpnType === 'openvpn' && !this.nodeConfig.vpn_protocol)
			this.nodeConfig.vpn_protocol = 'udp';
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
	 * Set VPN protocol but do not save it to the configuration file
	 * @param vpnProtocol string
	 * @returns void
	 */
	public setVpnProtocol(vpnProtocol: string): void
	{
		this.nodeConfig.vpn_protocol = vpnProtocol;
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
export const isWireguardConfigFileAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'wireguard', 'config.toml'));
export const isV2RayConfigFileAvailable = (): boolean => nodeManager.isConfigFileAvailable(path.join(config.CONFIG_DIR, 'v2ray', 'config.toml'));
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
