#!/usr/bin/env node
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import fetch, { type Response } from "node-fetch"
import enquirer from "enquirer"
const { prompt } = enquirer
import ora from "ora"
import chalk from "chalk"
import { dedent } from "ts-dedent"

const isFailure = (response: Response) => response.status >= 400

let project: string

if (process.argv.length > 2) {
    const [, , proj] = process.argv

    project = proj
} else {
    project = (await prompt({
        type: "input",
        name: "project",
        message: "Project path"
    }).catch(() => process.exit(1)) as { project: string }).project
}

if (project == "--help" || project == "-h") {
    console.log(dedent`
        Usage:
            gh-assets [project?]
        
        If no project is specified, the user will be prompted to enter one.
    `)
    process.exit()
}

const spinner = ora(chalk.bold("Finding releases...")).start()

const res = await fetch(`https://api.github.com/repos/${project}/releases`),
    json = await res.json() as any

if (isFailure(res)) {
    const messageWithIpRegex = /for \b(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\b/g

    if (json.message.match(messageWithIpRegex))
        json.message = json.message.replace(messageWithIpRegex, "")

    spinner.fail(chalk.bold("Error: ") + chalk.red(json.message))
    process.exit(1)
}

if (json.length === 0) {
    spinner.fail(chalk.bold("Error: ") + chalk.red("No releases found"))
    process.exit(1)
}

spinner.succeed(chalk.bold(`Found ${json.length} releases`))

const tags: string[] = json.map((x: any) => x.tag_name)

const { tag } = await prompt({
    type: "select",
    name: "tag",
    message: "Select a tag",
    choices: tags
}).catch(() => process.exit(1)).catch(() => process.exit(1)) as { tag: string }

const release = json.find((x: any) => x.tag_name === tag)

const spinner2 = ora(chalk.bold("Finding assets...")).start()

const { assets_url } = release

const res2 = await fetch(assets_url),
    json2 = await res2.json() as any

if (isFailure(res2)) {
    console.log("Error: " + json2.message)
    process.exit(1)
}

const names: string[] = json2.map((x: any) => x.name)

let downloadUrl: string,
    filename: string

if (names.length === 0) {
    spinner2.fail(chalk.bold("Error: ") + chalk.red("No assets found"))

    const { source } = await prompt({
        type: "confirm",
        name: "source",
        initial: true,
        message: "Download source instead?"
    }).catch(() => process.exit(1)) as { source: boolean }

    if (source) {
        const { zipOrTar } = await prompt({
            type: "select",
            name: "zipOrTar",
            message: "Select a format",
            choices: ["zip", "tar"]
        }).catch(() => process.exit(1)) as { zipOrTar: "zip" | "tar" }

        if (zipOrTar === "zip")
            downloadUrl = release.zipball_url
        else
            downloadUrl = release.tarball_url

        filename = `${project.replace("/", "-")}-${tag}.${zipOrTar}`
    } else
        process.exit()
} else {
    spinner2.succeed(chalk.bold(`Found ${names.length} assets`))

    const { name } = await prompt({
        type: "select",
        name: "name",
        message: "Select a file",
        choices: names
    }).catch(() => process.exit(1)) as { name: string }

    filename = name

    downloadUrl = json2.find((x: any) => x.name === name).browser_download_url
}

const spinner3 = ora(chalk.bold("Downloading...")).start()

const res3 = await fetch(downloadUrl)

if (isFailure(res3)) {
    spinner3.fail(chalk.bold("Error: ") + chalk.red(json2.message))
    process.exit(1)
}

const buffer = Buffer.from(await res3.arrayBuffer())

while (existsSync(`./${filename}`)) {
    const extension = filename.split(".").at(-1) ?? ""
    filename = filename.slice(0, -extension.length - 1)
    filename += `-copy.${extension}`
}

await fs.writeFile(filename, buffer)

spinner3.succeed(chalk.bold("Downloaded!"))
