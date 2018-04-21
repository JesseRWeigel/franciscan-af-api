import mongoose from 'mongoose'
import { distanceInWordsToNow } from 'date-fns'
import gitql from '../lib/graphql'
import axios from 'axios'
import md from '../lib/markdown'

const Repos = mongoose.model('Repo')

export default {
  Repo: {
    readme: async ({ nameWithOwner, url }, _, { user }) => {
      const [repoOwner, repoName] = nameWithOwner.split('/')
      try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/readme`, {
          headers: {
            Accept: 'application/vnd.github.VERSION.raw',
            Authorization: `Bearer ${user.token}`
          }
        })
        return md(data, {
          repository: {
            type: 'git',
            url
          }
        })
      } catch (e) {
        return null
      }
    },
    activity: async ({ nameWithOwner, url }, _, { user }) => {
      const [repoOwner, repoName] = nameWithOwner.split('/')
      try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/stats/participation`, {
          headers: {
            Authorization: `Bearer ${user.token}`
          }
        })
        return data.all
      } catch (e) {
        return null
      }
    }
  },
  Query: {
    getRepos: async (_, { page = 1 }) => {
      const limit = 25
      const skip = page * limit - limit
      const repos = await Repos.find()
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: 'desc' })

      return repos
    },
    getRepo: async (_, { id }, { user }) => {
      const dbData = await Repos.findById(id)
      const [repoOwner, repoName] = dbData.nameWithOwner.split('/')
      const { data: { data: { repository } } } = await gitql({
        query: `
        {
          repository(owner: "${repoOwner}", name: "${repoName}") {
            pushedAt
            issues(states: OPEN) {
              totalCount
            }
            pullRequests(states: OPEN) {
              totalCount
            }
            homepageUrl
            stargazers {
              totalCount
            }
            licenseInfo {
              name
              nickname
            }
          }
        }

        `,
        headers: { Authorization: `Bearer ${user.token}` }
      })
      return {
        ...dbData.toJSON(),
        starCount: repository.stargazers.totalCount,
        issues: repository.issues.totalCount,
        license: repository.licenseInfo
          ? repository.licenseInfo.nickname ? repository.licenseInfo.nickname : repository.licenseInfo.name
          : null,
        homepage: repository.homepageUrl,
        prs: repository.pullRequests.totalCount,
        pushedAt: distanceInWordsToNow(repository.pushedAt, {
          addSuffix: true
        })
      }
    }
  },
  Mutation: {
    createRepository: async (_, { name, nameWithOwner, description }, { user }) => {
      const [repoOwner, repoName] = nameWithOwner.split('/')
      const { data: { data: { repository } } } = await gitql({
        query: `
        {
          repository(name: "${repoName}", owner: "${repoOwner}") {
            name
            nameWithOwner
            url
            stargazers {
              totalCount
            }
          }
        }

        `,
        headers: {
          Authorization: `bearer ${user.token}`
        }
      })
      const repoData = {
        name,
        nameWithOwner,
        owner: user._id,
        url: repository.url,
        starCount: repository.stargazers.totalCount,
        description
      }
      let newRepo = await Repos.create(repoData)
      newRepo = newRepo.toObject()
      newRepo.owner = {
        _id: user._id,
        photoURL: user.photoURL,
        name: user.name,
        bio: user.bio
      }
      return newRepo
    }
  }
}
