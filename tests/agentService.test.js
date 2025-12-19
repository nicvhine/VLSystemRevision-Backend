const { createAgent, getAllAgentsWithStats, getAgentDetails } = require('../services/agentService');
const { generateAgentId } = require('../utils/generator');

jest.mock('../utils/generator');

describe('Agent Service', () => {
  let mockRepo;

  beforeEach(() => {
    mockRepo = {
      findAgentByNameAndPhone: jest.fn(),
      insertAgent: jest.fn(),
      getAllAgents: jest.fn(),
      getAssignedApplications: jest.fn(),
      updateAgentStats: jest.fn(),
      getAgentById: jest.fn(),
    };
    generateAgentId.mockReset();
  });

  describe('createAgent', () => {
    test('should create a new agent successfully', async () => {
      generateAgentId.mockResolvedValue('AGENT001');
      mockRepo.findAgentByNameAndPhone.mockResolvedValue(null);
      mockRepo.insertAgent.mockResolvedValue();

      const agentData = { name: 'John Doe', phoneNumber: '1234567890' };
      const newAgent = await createAgent(agentData, mockRepo, {});

      expect(newAgent).toMatchObject({
        agentId: 'AGENT001',
        name: 'John Doe',
        phoneNumber: '1234567890',
        handledLoans: 0,
        totalLoanAmount: 0,
        totalCommission: 0,
      });
      expect(mockRepo.insertAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'AGENT001' }));
    });

    test('should throw error if fields are missing', async () => {
      await expect(createAgent({ name: 'John' }, mockRepo, {}))
        .rejects.toThrow('All fields are required');
    });

    test('should throw error if full name not provided', async () => {
      await expect(createAgent({ name: 'John', phoneNumber: '123' }, mockRepo, {}))
        .rejects.toThrow('Please enter a full name');
    });

    test('should throw error if agent already exists', async () => {
      mockRepo.findAgentByNameAndPhone.mockResolvedValue({ agentId: 'AGENT001' });
      await expect(createAgent({ name: 'John Doe', phoneNumber: '123' }, mockRepo, {}))
        .rejects.toThrow('Agent with this name and phone number already exists');
    });
  });

  describe('getAllAgentsWithStats', () => {
    test('should return agents with updated stats', async () => {
      const agents = [{ agentId: 'AGENT001', name: 'John Doe', phoneNumber: '123' }];
      const applications = [{ appLoanAmount: 1000 }, { appLoanAmount: 500 }];
      
      mockRepo.getAllAgents.mockResolvedValue(agents);
      mockRepo.getAssignedApplications.mockResolvedValue(applications);
      mockRepo.updateAgentStats.mockResolvedValue();

      const result = await getAllAgentsWithStats(mockRepo);

      expect(result[0]).toMatchObject({
        handledLoans: 2,
        totalLoanAmount: 1500,
        totalCommission: 75,
      });
      expect(mockRepo.updateAgentStats).toHaveBeenCalledWith('AGENT001', expect.any(Object));
    });

    test('should return agents even if no assigned applications', async () => {
      const agents = [{ agentId: 'AGENT002', name: 'Jane Doe', phoneNumber: '456' }];
      mockRepo.getAllAgents.mockResolvedValue(agents);
      mockRepo.getAssignedApplications.mockResolvedValue([]);

      const result = await getAllAgentsWithStats(mockRepo);
      expect(result[0]).toMatchObject({ agentId: 'AGENT002', name: 'Jane Doe' });
      expect(mockRepo.updateAgentStats).not.toHaveBeenCalled();
    });
  });

  describe('getAgentDetails', () => {
    test('should return agent details with stats', async () => {
      const agent = { agentId: 'AGENT001', name: 'John Doe', phoneNumber: '123' };
      const applications = [{ appLoanAmount: 1000 }];
      mockRepo.getAgentById.mockResolvedValue(agent);
      mockRepo.getAssignedApplications.mockResolvedValue(applications);
      mockRepo.updateAgentStats.mockResolvedValue();

      const result = await getAgentDetails('AGENT001', mockRepo);

      expect(result).toMatchObject({
        agentId: 'AGENT001',
        handledLoans: 1,
        totalLoanAmount: 1000,
        totalCommission: 50,
      });
      expect(mockRepo.updateAgentStats).toHaveBeenCalledWith('AGENT001', expect.any(Object));
    });

    test('should throw error if agent not found', async () => {
      mockRepo.getAgentById.mockResolvedValue(null);
      await expect(getAgentDetails('UNKNOWN', mockRepo))
        .rejects.toThrow('Agent not found');
    });
  });
});
