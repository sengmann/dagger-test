import Client, { connect } from "@dagger.io/dagger"

const nginxConf = `
server {
  listen 80;
  sendfile on;
  default_type application/octet-stream;

  gzip on;
  gzip_http_version 1.1;
  gzip_disable      "MSIE [1-6]\.";
  gzip_min_length   256;
  gzip_vary         on;
  gzip_proxied      expired no-cache no-store private auth;
  gzip_types        text/plain text/css application/json application/javascript application/x-javascript text/xml application/xml application/xml+rss text/javascript;
  gzip_comp_level   9;

  root /usr/share/nginx/html;

  location / {
    try_files $uri $uri/ /index.html =404;
  }
}
`

// initialize Dagger client
await connect(async (client: Client) => {

  const secretsTemplateFile = client.host().directory('.', { include: ['secrets.tpl.json'] }).file('secrets.tpl.json')

  // can't use ?? because not set variable is delivered as empty string instead of null or undefined
  const onePasswordHost = (await client.host().envVariable('ONE_PASSWORD_HOST').value()) || "http://192.168.178.21:8080"
  const onePasswordToken = client.host().envVariable('ONE_PASSWORD_TOKEN').secret()

  const secretManager = client.container().from('1password/op:2')
    .withSecretVariable('OP_CONNECT_TOKEN', onePasswordToken)
    .withEnvVariable('OP_CONNECT_HOST', onePasswordHost)
    .withFile('/tmp/secrets.tpl.json', secretsTemplateFile)
    .withExec(['op', 'inject', '-i', '/tmp/secrets.tpl.json', '-o', '/tmp/secrets.json']);

  const secrets = secretManager.file('/tmp/secrets.json')
  // access secrets direct
  console.log(JSON.parse(await secrets.contents()).foo.username)

  const repoUrl = 'git@github.com:sengmann/dagger-ui-test.git'
  const sshAuthSockPath = process.env.SSH_AUTH_SOCK?.toString() ?? ""
  const sshAgentSocketID = await client.host().unixSocket(sshAuthSockPath).id()

  const repo = client
    // Retrieve the repository
    .git(repoUrl, { keepGitDir: true })
    // Select the main branch, and the filesystem tree associated
    .branch("main")
    .tree({
      sshAuthSocket: sshAgentSocketID,
    })

  const builder = client.container()
    .from('node:18')
    .withDirectory('/workdir', repo.directory('/'))
    .withWorkdir('/workdir')
    .withExec(['npm', 'ci'])
    .withExec(['npm', 'run', 'ng', '--', 'run', 'dagger-ui-test:build:production'])
    // or pass the file into a container
    .withFile('/tmp/secrets.json', secrets)
    // or pass file as a secret into container
    .withMountedSecret('/tmp/secrets2.json', secrets.secret())


  console.log(await builder.stdout())

  const runner = client.container()
    .from('nginx')
    .withNewFile('/etc/nginx/conf.d/default.conf', { contents: nginxConf })
    .withDirectory('/usr/share/nginx/html', builder.directory('/workdir/dist/apps/dagger-ui-test'))
    .withSecretVariable('ONE_PASSWORD_TOKEN', onePasswordToken)

  await runner.publish('sirion182/dagger-ui-test:latest')

}, { LogOutput: process.stdout })
