// const firebaseExecutable = new URL('../../../node_modules/.bin/firebase', import.meta.url).pathname;

const functionName = 'test'
const firebaseProjectId = 'agmcs2025'

console.log('Installing dependencies...')
const npmInstall = new Deno.Command('npm', {
  args: ['install'],
  cwd: 'dist',
})

const { code: npmCode, stdout: npmStdout, stderr: npmStderr } = await npmInstall.output()

if (npmCode === 0) {
  console.log('Dependencies installed successfully.')
  const npmOut = new TextDecoder().decode(npmStdout)
  if (npmOut) console.log(npmOut)
} else {
  console.error('Failed to install dependencies:')
  const npmErr = new TextDecoder().decode(npmStderr)
  if (npmErr) console.error(npmErr)
  Deno.exit(1)
}

const command = new Deno.Command('firebase', {
  args: [
    'deploy',
    '--only',
    `functions:${functionName}`,
    '--project',
    firebaseProjectId,
  ],
  cwd: 'dist',
})

console.log(`Deploying function ${functionName} to project ${firebaseProjectId}...`)

const { code, stdout, stderr } = await command.output()

const outStr = new TextDecoder().decode(stdout)
const errStr = new TextDecoder().decode(stderr)

if (code === 0) {
  console.log('Deployment successful!')
  if (outStr) console.log(outStr)
} else {
  console.error('Deployment failed:')
  if (errStr) console.error(errStr)
  if (outStr) console.log('stdout:\n', outStr)
  Deno.exit(1)
}
