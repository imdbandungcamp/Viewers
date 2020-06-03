import React, { Component } from 'react';
import { metadata, utils } from '@ohif/core';

import ConnectedViewer from './ConnectedViewer.js';
import PropTypes from 'prop-types';
import { extensionManager } from './../App.js';
import Dropzone from 'react-dropzone';
import filesToStudies from '../lib/filesToStudies';
import './ViewerLocalFileData.css';
import { withTranslation } from 'react-i18next';
import axios from 'axios';
import OSS from 'ali-oss';
import queryString from 'querystring';
import AppContext from '../context/AppContext';

const { OHIFStudyMetadata } = metadata;
const { studyMetadataManager, updateMetaDataManager } = utils;

const dropZoneLinkDialog = (onDrop, i18n, dir) => {
  return (
    <Dropzone onDrop={onDrop} noDrag>
      {({ getRootProps, getInputProps }) => (
        <span {...getRootProps()} className="link-dialog">
          {dir ? (
            <span>
              {i18n('Load folders')}
              <input
                {...getInputProps()}
                webkitdirectory="true"
                mozdirectory="true"
              />
            </span>
          ) : (
            <span>
              {i18n('Load files')}
              <input {...getInputProps()} />
            </span>
          )}
        </span>
      )}
    </Dropzone>
  );
};

const linksDialogMessage = (onDrop, i18n) => {
  return (
    <>
      {i18n('Or click to ')}
      {dropZoneLinkDialog(onDrop, i18n)}
      {i18n(' or ')}
      {dropZoneLinkDialog(onDrop, i18n, true)}
      {i18n(' from dialog')}
    </>
  );
};

class ViewerLocalFileData extends Component {
  static contextType = AppContext
  static propTypes = {
    studies: PropTypes.array,
  };

  state = {
    studies: null,
    loading: false,
    error: null,
    loadingProgress: {
      total: 0,
      progress: 0
    }
  };

  componentDidMount () {
    const { params } = this.props.match
    const urlParam = queryString.parse(this.props.location.search.replace('?', ''))
    const { kind, region, bucket, stsToken, accessKeyId, accessKeySecret } = urlParam
    console.log(urlParam)
    if (params) {
      let { imgUrl } = params
      imgUrl = imgUrl.replace(this.props.location.search, '')
      if (imgUrl) {
        this.setState({
          loading: true
        })

        if (!kind || kind === 'file') {
          axios.get(decodeURIComponent(imgUrl), {
            responseType: 'blob',
            headers: {
              'Content-Type': 'application/dicom',
            }
          }).then(response => {
            return filesToStudies([response.data])
          }).then(studies => {
            const updatedStudies = this.updateStudies(studies);

            if (!updatedStudies) {
              this.setState({
                loading: false
              })
            } else {
              this.setState({ studies: updatedStudies, loading: false });
            }
          }).catch(e => {
            this.setState({
              loading: false
            })
          })
        } else if (kind === 'folder') {
          let folderUrl = decodeURIComponent(imgUrl)
          if (bucket) {
            const client = new OSS({
              region,
              bucket,
              accessKeyId,
              accessKeySecret,
              stsToken,
              timeout: '360s'
            })

            client.list({
              prefix: folderUrl,
              'max-keys': 1000
            }).then(result => {
              const files = result.objects.filter(object => object.name.indexOf('__MACOSX') === -1 && object.size > 0)
              this.setState({
                loadingProgress: {
                  ...this.state.loadingProgress,
                  total: files.length
                }
              })
              let count = 0
              Promise.all(files.map(object => {
                return client.get(object.name).then(objects => {
                  this.setState({
                    loadingProgress: {
                      ...this.state.loadingProgress,
                      progress: ++count
                    }
                  })
                  return Promise.resolve(objects)
                }).catch(() => {
                  this.setState({
                    loadingProgress: {
                      ...this.state.loadingProgress,
                      progress: ++count
                    }
                  })
                  return Promise.resolve(null)
                })
              })).then(objects => {
                const contents = []
                objects && objects.forEach(object => {
                  if (object) {
                    const blobFile = new Blob([object.content])
                    contents.push(new File([blobFile], 'name'))
                  }
                })

                return filesToStudies(contents);
              }).then(studies => {
                const updatedStudies = this.updateStudies(studies);

                if (!updatedStudies) {
                  this.setState({
                    loading: false
                  })
                } else {
                  this.setState({ studies: updatedStudies, loading: false });
                }
              }).catch(e => {
                return Promise.reject(e)
              })
            }).catch(e => {
              this.setState({
                error: e.message,
                loading: false
              })
            })
          }
        }
      }
    }
  }

  updateStudies = studies => {
    // Render the viewer when the data is ready
    studyMetadataManager.purge();

    // Map studies to new format, update metadata manager?
    const updatedStudies = studies.map(study => {
      const studyMetadata = new OHIFStudyMetadata(
        study,
        study.studyInstanceUid
      );
      const sopClassHandlerModules =
        extensionManager.modules['sopClassHandlerModule'];

      study.displaySets =
        study.displaySets ||
        studyMetadata.createDisplaySets(sopClassHandlerModules);
      studyMetadata.setDisplaySets(study.displaySets);

      studyMetadata.forEachDisplaySet(displayset => {
        displayset.localFile = true;
      });
      // Updates WADO-RS metaDataManager
      updateMetaDataManager(study);

      studyMetadataManager.add(studyMetadata);

      return study;
    });

    this.setState({
      studies: updatedStudies,
    });
  };

  render() {
    const onDrop = async acceptedFiles => {
      this.setState({ error: null, loading: true });

      const studies = await filesToStudies(acceptedFiles);
      const updatedStudies = this.updateStudies(studies);

      if (!updatedStudies) {
        return;
      }

      this.setState({ studies: updatedStudies, loading: false });
    };

    return (
      <Dropzone onDrop={onDrop} noClick>
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()} style={{ width: '100%', height: '100%' }}>
            {this.state.studies ? (
              <ConnectedViewer
                isStudyLoaded={true}
                studies={this.state.studies}
                studyInstanceUids={
                  this.state.studies &&
                  this.state.studies.map(a => a.studyInstanceUid)
                }
              />
            ) : (
              <div className={'drag-drop-instructions'}>
                <div className={'drag-drop-contents'}>
                  {this.state.error && <h3>Error: {JSON.stringify(this.state.error)}</h3>}
                  {this.state.loading ? (
                    <h3>{this.props.t('Loading...')} {this.state.loadingProgress.progress}/{this.state.loadingProgress.total}</h3>
                  ) : (
                    <>
                      <h3>
                        {this.props.t(
                          'Drag and Drop DICOM files here to load them in the Viewer'
                        )}
                      </h3>
                      <h4>{linksDialogMessage(onDrop, this.props.t)}</h4>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Dropzone>
    );
  }
}

export default withTranslation('Common')(ViewerLocalFileData);
