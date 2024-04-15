import {parseArgs} from "util";


// mock fetch for auth testing
global.fetch = jest.fn();
jest.mock('util', () => {
    const original = jest.requireActual("util"); // Step 2.
    return {
        ...original,
        parseArgs: jest.fn()
    };
});
describe('test cli_client command execution', () => {
    beforeEach(() => {
        // fake auth
        (global.fetch as jest.Mock).mockResolvedValueOnce({status: 200});
    });
    afterEach(() => {
    });
    describe('test PAGE command argument validations', () => {
        it('CREATE should take correct args and throw no location error', async () => {

            const location = './exampleLocation';
            const projectName = 'my-fancy-wonderland';
            (parseArgs as jest.Mock).mockImplementation((options: {
                options: { [key: string]: { type: string, default: any } }
            }) => {
                const returnedValue: any = {
                    positionals: ['page', 'create', projectName, location],
                    values: {}
                };

                Object.entries(options.options).forEach(([value, data]) => {
                        returnedValue.values[value] = data.default;
                    }
                )
                return returnedValue;
            });


            let error;
            try {
                // "fake" starting the cli client via bin script
                await (require('../src/cli_client').default as Promise<unknown>);
            } catch (err) {
                error = err;
            }

            expect(error).toBeDefined();
            expect((error as Error).message).toMatch(`${location} not found`);

        });
        it('UPDATE should take correct args and throw no location error', async () => {
            const location = './exampleLocation';
            const projectName = 'my-fancy-wonderland';
            (parseArgs as jest.Mock).mockImplementation((options: {
                options: { [key: string]: { type: string, default: any } }
            }) => {
                const returnedValue: any = {
                    positionals: ['page', 'update', projectName, location],
                    values: {}
                };

                Object.entries(options.options).forEach(([value, data]) => {
                        returnedValue.values[value] = data.default;
                    }
                )
                return returnedValue;
            });

            let error;
            try {
                // "fake" starting the cli client via bin script
                await (require('../src/cli_client').default as Promise<unknown>);
            } catch (err) {
                error = err;
            }

            expect(error).toBeDefined();

            expect((error as Error).message).toMatch(`${location} not found`);
        });

    });
});